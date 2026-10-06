import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  buildSessions,
  classifyLogFile,
  compareLogFiles,
  computeStats,
  inferLatestLogDate,
  parseIsoDate,
  parseLog,
  pickHighlights,
  resolvePlayers,
  zonedTimeToUtc,
  type LogEvent,
  type LogFileInfo,
  type TimelineItem,
} from "@smp/core";
import { createIngestStore, type IngestStore, type LogFileRow, type Sql } from "@smp/db";
import type { LogSource, RemoteFile, ServerFs } from "./sources/types";
import { syncWorldData, type WorldSyncSummary } from "./world-sync";

export interface IngestOptions {
  source: LogSource;
  /** Server root, for per-player world data (stats/advancements/player data). Optional. */
  world?: ServerFs;
  sql: Sql;
  mode: "import" | "sync";
  /** Timezone the server writes log timestamps in (UTC on WiseHosting). */
  serverTimeZone: string;
  /** Timezone for daily/hourly statistics (the players' timezone). */
  statsTimeZone: string;
  /** Re-parse every available file from scratch (after parser updates). */
  reparse?: boolean;
  log?: (msg: string) => void;
  now?: () => number;
}

export interface IngestSummary {
  filesSeen: number;
  filesSkipped: number;
  filesProcessed: number;
  newLines: number;
  insertedEvents: number;
  counts: Partial<Record<LogEvent["type"], number>>;
  newIssues: number;
  totalIssues: number;
  players: number;
  newPlayers: number;
  sessions: number;
  openSessions: number;
  world: WorldSyncSummary | null;
  durationMs: number;
}

/**
 * The whole ingestion run, used by both `import` and `sync`:
 *
 *   1. list log files, oldest first
 *   2. for each file: skip if already complete, else download, parse, and
 *      append only lines after the stored offset (idempotent per line)
 *   3. rebuild derived data (players, sessions, runs, stats) from all events
 */
export async function runIngestion(opts: IngestOptions): Promise<IngestSummary> {
  const log = opts.log ?? (() => {});
  const started = Date.now();
  const store = createIngestStore(opts.sql);
  const runId = await store.startSyncRun(opts.mode);
  const summary: IngestSummary = {
    filesSeen: 0,
    filesSkipped: 0,
    filesProcessed: 0,
    newLines: 0,
    insertedEvents: 0,
    counts: {},
    newIssues: 0,
    totalIssues: 0,
    players: 0,
    newPlayers: 0,
    sessions: 0,
    openSessions: 0,
    world: null,
    durationMs: 0,
  };

  try {
    log(`Connected to ${opts.source.description}`);
    const remote = await opts.source.list();
    const files = remote
      .map((r) => ({ remote: r, info: classifyLogFile(r.name) }))
      .filter((f): f is { remote: RemoteFile; info: LogFileInfo } => f.info !== null)
      .sort((a, b) => compareLogFiles(a.info, b.info));
    summary.filesSeen = files.length;
    const hasLatest = files.some((f) => f.info.kind === "latest");
    log(`Found ${files.length} log file(s)${hasLatest ? " including latest.log" : ""}`);

    const known = new Set(await store.knownPlayerNames());
    for (const { remote: file, info } of files) {
      await processFile(store, opts, file, info, known, summary, log);
    }

    if (opts.world) {
      log("Reading player world data (statistics, advancements, player data)…");
      summary.world = await syncWorldData(opts.world, opts.sql, log, (opts.now ?? Date.now)());
    }

    log("Rebuilding sessions and statistics…");
    await rebuildDerived(store, opts, summary);
    summary.totalIssues = await store.issueCount();
    summary.durationMs = Date.now() - started;
    await store.finishSyncRun(runId, "success", summary);
    return summary;
  } catch (err) {
    summary.durationMs = Date.now() - started;
    await store.finishSyncRun(runId, "failed", summary, err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}

async function processFile(
  store: IngestStore,
  opts: IngestOptions,
  file: RemoteFile,
  info: LogFileInfo,
  known: Set<string>,
  summary: IngestSummary,
  log: (msg: string) => void,
): Promise<void> {
  // Rotated files never change: if we've finished this exact file, don't even download it.
  if (info.kind === "rotated" && !opts.reparse && (await store.findCompletedBySource(file.name, file.size))) {
    summary.filesSkipped++;
    return;
  }

  const raw = await opts.source.read(file.name);
  const text = new TextDecoder("utf-8").decode(info.kind === "rotated" && info.gzip ? gunzipSync(raw) : raw);
  const firstLine = text.slice(0, Math.max(0, text.indexOf("\n"))).replace(/\r$/, "");
  if (firstLine.trim() === "") {
    log(`  ${file.name}: empty, skipping`);
    summary.filesSkipped++;
    return;
  }

  const parsed = parseLog(text, { knownPlayers: known, dropIncompleteLastLine: info.kind === "latest" });
  const date =
    info.kind === "rotated" ? info.date : inferLatestLogDate(file.mtimeMs, parsed.lastSecondOfDay, opts.serverTimeZone);
  const firstLineHash = sha256(firstLine);
  const fingerprint = `${date}|${firstLineHash}`;

  let row: LogFileRow | null = await store.findByFingerprint(fingerprint);
  if (!row && info.kind === "rotated") {
    // Is this the .gz that a latest.log we were tracking got rotated into?
    const previous = await store.findIncompleteByFirstLine(firstLineHash);
    if (previous) {
      if (previous.log_date !== date) {
        log(`  ${file.name}: correcting date ${previous.log_date} → ${date}; re-importing its lines`);
        await store.redateLogFile(previous.id, fingerprint, date);
        row = { ...previous, fingerprint, log_date: date, lines_processed: 0 };
      } else {
        row = previous;
      }
    }
  }
  row ??= await store.createLogFile({
    fingerprint,
    firstLineHash,
    sourceName: file.name,
    logDate: date,
    seq: info.kind === "rotated" ? info.seq : null,
  });
  if (opts.reparse && row.lines_processed > 0) {
    await store.resetLogFile(row.id);
    row = { ...row, lines_processed: 0, is_complete: false };
  }

  for (const { event } of parsed.events) if ("player" in event && event.type !== "DEATH") known.add(event.player);

  const isComplete = info.kind === "rotated";
  const newLineCount = Math.max(0, parsed.totalLines - row.lines_processed);
  if (newLineCount === 0 && row.is_complete === isComplete) {
    summary.filesSkipped++;
    return;
  }

  const civil = parseIsoDate(date)!;
  const toUtc = (second: number, dayOffset: number) => zonedTimeToUtc(civil, second, opts.serverTimeZone, dayOffset);
  const fresh = parsed.events.filter((e) => e.lineNo > row.lines_processed);
  const issues = parsed.issues.filter((i) => i.lineNo > row.lines_processed);

  const inserted = await store.appendLines(
    row,
    fresh.map((e) => ({ lineNo: e.lineNo, ts: toUtc(e.secondOfDay, e.dayOffset), event: e.event })),
    issues,
    {
      linesProcessed: parsed.totalLines,
      firstTs: parsed.firstSecondOfDay === null ? null : toUtc(parsed.firstSecondOfDay, 0),
      lastTs: parsed.lastSecondOfDay === null ? null : toUtc(parsed.lastSecondOfDay, parsed.lastDayOffset),
      sizeBytes: file.size,
      isComplete,
      sourceName: file.name,
      seq: info.kind === "rotated" ? info.seq : null,
    },
  );

  for (const e of fresh) summary.counts[e.event.type] = (summary.counts[e.event.type] ?? 0) + 1;
  summary.filesProcessed++;
  summary.newLines += newLineCount;
  summary.insertedEvents += inserted;
  summary.newIssues += issues.length;

  const joins = fresh.filter((e) => e.event.type === "JOIN").length;
  const leaves = fresh.filter((e) => e.event.type === "LEAVE").length;
  log(
    `  ${file.name} (${date}): ${newLineCount} new line(s), ${inserted} event(s)` +
      (joins || leaves ? `, ${joins} join(s), ${leaves} leave(s)` : "") +
      (issues.length ? `, ${issues.length} parse issue(s)` : ""),
  );
  for (const issue of issues.slice(0, 5)) log(`    ! line ${issue.lineNo} [${issue.reason}]: ${issue.raw}`);
  if (issues.length > 5) log(`    ! … and ${issues.length - 5} more (see smp.parse_issues)`);
}

async function rebuildDerived(store: IngestStore, opts: IngestOptions, summary: IngestSummary) {
  const rows = await store.loadAllEvents();
  const items = rows.map((r) => ({ id: String(r.id), ts: r.ts.getTime(), event: { type: r.type, ...r.data } as LogEvent }));
  const { keys, players } = resolvePlayers(items);

  const timeline: TimelineItem[] = items.map((it, i) => ({
    kind: "event",
    id: it.id,
    ts: it.ts,
    event: it.event,
    ...(keys[i] ? { playerKey: keys[i]! } : {}),
  }));
  for (const ts of await store.loadHeartbeats()) timeline.push({ kind: "heartbeat", ts });
  // Stable sort: events keep log order within the same second; heartbeats go after them.
  timeline.sort((a, b) => a.ts - b.ts || (a.kind === b.kind ? 0 : a.kind === "heartbeat" ? 1 : -1));

  const built = buildSessions(timeline);
  const stats = computeStats({
    playerKeys: [...players.keys()],
    sessions: built.sessions,
    events: items
      .map((it, i) => ({ playerKey: keys[i] ?? null, ts: it.ts, event: it.event }))
      .filter((e) => ["DEATH", "ADVANCEMENT", "CHAT", "SERVER_START"].includes(e.event.type)),
    serverRuns: built.serverRuns,
    timeZone: opts.statsTimeZone,
    now: (opts.now ?? Date.now)(),
  });

  const { newPlayers } = await store.writeDerived({
    players,
    eventPlayerKeys: items.map((it, i) => ({ eventId: Number(it.id), playerKey: keys[i] ?? null })),
    sessions: built.sessions,
    serverRuns: built.serverRuns,
    playerStats: stats.players,
    highlights: new Map([...stats.players.keys()].map((key) => [key, pickHighlights(key, stats.players)])),
    serverStats: stats.server,
  });

  summary.players = players.size;
  summary.newPlayers = newPlayers;
  summary.sessions = built.sessions.length;
  summary.openSessions = built.sessions.filter((s) => s.endReason === "open").length;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
