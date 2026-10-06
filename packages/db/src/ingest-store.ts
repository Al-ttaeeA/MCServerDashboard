import type { BuiltServerRun, BuiltSession, LogEvent, LogEventType, ParseIssue, PlayerIdentity, PlayerStats, ServerStats } from "@smp/core";
import { deathCategory, nextColorIndex } from "@smp/core";
import type { Sql } from "./executor";

/**
 * Write-side queries used by the ingester. All bulk writes pass a single
 * JSON parameter and expand it with `jsonb_to_recordset`, which behaves the
 * same in postgres.js and PGlite and keeps round-trips to one per batch.
 */

export interface LogFileRow {
  id: number;
  fingerprint: string;
  first_line_hash: string;
  source_name: string;
  log_date: string;
  seq: number | null;
  lines_processed: number;
  size_bytes: number | null;
  is_complete: boolean;
}

const LOG_FILE_COLS = `id, fingerprint, first_line_hash, source_name, to_char(log_date, 'YYYY-MM-DD') as log_date,
  seq, lines_processed, size_bytes, is_complete`;

export function createIngestStore(sql: Sql) {
  return {
    async startSyncRun(mode: "import" | "sync"): Promise<number> {
      const [row] = await sql.query<{ id: number }>("insert into smp.sync_runs (mode) values ($1) returning id", [mode]);
      return row!.id;
    },

    async finishSyncRun(id: number, status: "success" | "failed", summary: object, error?: string) {
      await sql.query(
        "update smp.sync_runs set finished_at = now(), status = $2, summary = $3::jsonb, error = $4 where id = $1",
        [id, status, JSON.stringify(summary), error ?? null],
      );
    },

    /** A rotated file we've fully processed under this exact name and size — skip without downloading. */
    async findCompletedBySource(sourceName: string, sizeBytes: number): Promise<LogFileRow | null> {
      const [row] = await sql.query<LogFileRow>(
        `select ${LOG_FILE_COLS} from smp.log_files where source_name = $1 and size_bytes = $2 and is_complete`,
        [sourceName, sizeBytes],
      );
      return row ?? null;
    },

    async findByFingerprint(fingerprint: string): Promise<LogFileRow | null> {
      const [row] = await sql.query<LogFileRow>(`select ${LOG_FILE_COLS} from smp.log_files where fingerprint = $1`, [fingerprint]);
      return row ?? null;
    },

    /** An in-progress latest.log whose first line matches — the file a new .gz was rotated from. */
    async findIncompleteByFirstLine(firstLineHash: string): Promise<LogFileRow | null> {
      const [row] = await sql.query<LogFileRow>(
        `select ${LOG_FILE_COLS} from smp.log_files where first_line_hash = $1 and not is_complete order by id desc limit 1`,
        [firstLineHash],
      );
      return row ?? null;
    },

    async createLogFile(f: { fingerprint: string; firstLineHash: string; sourceName: string; logDate: string; seq: number | null }) {
      const [row] = await sql.query<LogFileRow>(
        `insert into smp.log_files (fingerprint, first_line_hash, source_name, log_date, seq)
         values ($1, $2, $3, $4::date, $5) returning ${LOG_FILE_COLS}`,
        [f.fingerprint, f.firstLineHash, f.sourceName, f.logDate, f.seq],
      );
      return row!;
    },

    /** Re-dates a file (its events are deleted so they get re-inserted with corrected timestamps). */
    async redateLogFile(id: number, fingerprint: string, logDate: string) {
      await sql.transaction(async (tx) => {
        await tx.query("delete from smp.events where log_file_id = $1", [id]);
        await tx.query("delete from smp.parse_issues where log_file_id = $1", [id]);
        await tx.query(
          "update smp.log_files set fingerprint = $2, log_date = $3::date, lines_processed = 0, updated_at = now() where id = $1",
          [id, fingerprint, logDate],
        );
      });
    },

    /** Forget processing progress so the file is parsed again from line 1 (after parser updates). */
    async resetLogFile(id: number) {
      await sql.transaction(async (tx) => {
        await tx.query("delete from smp.events where log_file_id = $1", [id]);
        await tx.query("delete from smp.parse_issues where log_file_id = $1", [id]);
        await tx.query("update smp.log_files set lines_processed = 0, is_complete = false, updated_at = now() where id = $1", [id]);
      });
    },

    /**
     * Inserts events and issues for lines after `lines_processed` and
     * advances the file's progress — all in one transaction, so a crash
     * mid-way leaves no partial state. Returns the number of new events.
     */
    async appendLines(
      file: LogFileRow,
      rows: { lineNo: number; ts: number; event: LogEvent }[],
      issues: ParseIssue[],
      progress: {
        linesProcessed: number;
        firstTs: number | null;
        lastTs: number | null;
        sizeBytes: number;
        isComplete: boolean;
        sourceName: string;
        seq: number | null;
      },
    ): Promise<number> {
      return sql.transaction(async (tx) => {
        let inserted = 0;
        if (rows.length > 0) {
          const payload = rows.map((r) => {
            const { type, ...rest } = r.event;
            const data = r.event.type === "DEATH" ? { ...rest, category: deathCategory(r.event.cause) } : rest;
            return { line_no: r.lineNo, ts: new Date(r.ts).toISOString(), type, data };
          });
          const res = await tx.query<{ id: number }>(
            `insert into smp.events (log_file_id, line_no, ts, type, data)
             select $1, x.line_no, x.ts, x.type::smp.event_type, x.data
             from jsonb_to_recordset($2::jsonb) as x(line_no int, ts timestamptz, type text, data jsonb)
             on conflict (log_file_id, line_no) do nothing
             returning id`,
            [file.id, JSON.stringify(payload)],
          );
          inserted = res.length;
        }
        if (issues.length > 0) {
          await tx.query(
            `insert into smp.parse_issues (log_file_id, line_no, reason, raw)
             select $1, x.line_no, x.reason, x.raw
             from jsonb_to_recordset($2::jsonb) as x(line_no int, reason text, raw text)
             on conflict do nothing`,
            [file.id, JSON.stringify(issues.map((i) => ({ line_no: i.lineNo, reason: i.reason, raw: i.raw })))],
          );
        }
        await tx.query(
          `update smp.log_files set
             lines_processed = greatest(lines_processed, $2),
             first_ts = coalesce(first_ts, $3::timestamptz),
             last_ts = greatest(coalesce(last_ts, $4::timestamptz), $4::timestamptz),
             size_bytes = $5, is_complete = $6, source_name = $7, seq = $8, updated_at = now()
           where id = $1`,
          [
            file.id,
            progress.linesProcessed,
            progress.firstTs === null ? null : new Date(progress.firstTs).toISOString(),
            progress.lastTs === null ? null : new Date(progress.lastTs).toISOString(),
            progress.sizeBytes,
            progress.isComplete,
            progress.sourceName,
            progress.seq,
          ],
        );
        return inserted;
      });
    },

    async knownPlayerNames(): Promise<string[]> {
      const rows = await sql.query<{ name: string }>("select distinct name from smp.player_names");
      return rows.map((r) => r.name);
    },

    /** Every event in log order — the input to the full rebuild. */
    async loadAllEvents(): Promise<{ id: number; ts: Date; type: LogEventType; data: Record<string, unknown> }[]> {
      return sql.query(
        `select e.id, e.ts, e.type::text as type, e.data
         from smp.events e join smp.log_files f on f.id = e.log_file_id
         order by f.log_date, f.seq nulls last, f.id, e.line_no`,
      );
    },

    /** Last line of every file: proves the server was up at that time (crash end estimates). */
    async loadHeartbeats(): Promise<number[]> {
      const rows = await sql.query<{ last_ts: Date }>("select last_ts from smp.log_files where last_ts is not null");
      return rows.map((r) => r.last_ts.getTime());
    },

    async issueCount(): Promise<number> {
      const [row] = await sql.query<{ n: number }>("select count(*)::int as n from smp.parse_issues");
      return row!.n;
    },

    /**
     * Replaces all derived data (players, sessions, runs, stats) in one
     * transaction. Readers never see a half-rebuilt state.
     */
    async writeDerived(input: {
      players: Map<string, PlayerIdentity>;
      eventPlayerKeys: { eventId: number; playerKey: string | null }[];
      sessions: (BuiltSession & { joinEventId: string; leaveEventId: string | null })[];
      serverRuns: BuiltServerRun[];
      playerStats: Map<string, PlayerStats>;
      serverStats: ServerStats;
    }): Promise<{ newPlayers: number }> {
      return sql.transaction(async (tx) => {
        // 1. Players — keep existing ids and colours; new players get the next free colour.
        const existing = await tx.query<{ id: number; player_key: string; color_index: number }>(
          "select id, player_key, color_index from smp.players",
        );
        const byKey = new Map(existing.map((p) => [p.player_key, p]));
        const used = existing.map((p) => p.color_index);
        const ordered = [...input.players.values()].sort((a, b) => a.firstSeenTs - b.firstSeenTs);
        let newPlayers = 0;
        const payload = ordered.map((p) => {
          let color = byKey.get(p.key)?.color_index;
          if (color === undefined) {
            color = nextColorIndex(used);
            used.push(color);
            newPlayers++;
          }
          return {
            player_key: p.key,
            uuid: p.uuid,
            name: p.name,
            color_index: color,
            first_seen: new Date(p.firstSeenTs).toISOString(),
            last_seen: new Date(p.lastSeenTs).toISOString(),
          };
        });
        const ids = await tx.query<{ id: number; player_key: string }>(
          `insert into smp.players (player_key, uuid, name, color_index, first_seen, last_seen)
           select x.player_key, x.uuid::uuid, x.name, x.color_index, x.first_seen, x.last_seen
           from jsonb_to_recordset($1::jsonb) as x(player_key text, uuid text, name text, color_index int, first_seen timestamptz, last_seen timestamptz)
           on conflict (player_key) do update set
             uuid = excluded.uuid, name = excluded.name,
             first_seen = excluded.first_seen, last_seen = excluded.last_seen, updated_at = now()
           returning id, player_key`,
          [JSON.stringify(payload)],
        );
        const idByKey = new Map(ids.map((r) => [r.player_key, r.id]));
        const pid = (key: string) => {
          const id = idByKey.get(key);
          if (id === undefined) throw new Error(`Unknown player key ${key}`);
          return id;
        };

        await tx.query(
          `insert into smp.player_names (player_id, name, first_seen, last_seen)
           select x.player_id, x.name, x.first_seen, x.last_seen
           from jsonb_to_recordset($1::jsonb) as x(player_id bigint, name text, first_seen timestamptz, last_seen timestamptz)
           on conflict (player_id, name) do update set last_seen = greatest(smp.player_names.last_seen, excluded.last_seen)`,
          [
            JSON.stringify(
              ordered.flatMap((p) =>
                p.names.map((name) => ({
                  player_id: pid(p.key),
                  name,
                  first_seen: new Date(p.firstSeenTs).toISOString(),
                  last_seen: new Date(p.lastSeenTs).toISOString(),
                })),
              ),
            ),
          ],
        );

        // 2. Point events at players (only rows that changed).
        await tx.query(
          `update smp.events e set player_id = x.player_id
           from jsonb_to_recordset($1::jsonb) as x(id bigint, player_id bigint)
           where e.id = x.id and e.player_id is distinct from x.player_id`,
          [
            JSON.stringify(
              input.eventPlayerKeys.map((e) => ({ id: e.eventId, player_id: e.playerKey ? (idByKey.get(e.playerKey) ?? null) : null })),
            ),
          ],
        );

        // 3. Sessions & server runs are fully derived — replace them.
        await tx.query("delete from smp.sessions");
        await tx.query("delete from smp.server_runs");
        // One insert per run (a handful per day at most) so ids map to indexes reliably.
        const runIds: number[] = [];
        for (const r of input.serverRuns) {
          const [row] = await tx.query<{ id: number }>(
            `insert into smp.server_runs (start_ts, end_ts, end_reason, version, start_event_id)
             values ($1, $2, $3, $4, $5) returning id`,
            [
              new Date(r.startTs).toISOString(),
              new Date(r.endTs).toISOString(),
              r.endReason,
              r.version,
              r.startEventId === null ? null : Number(r.startEventId),
            ],
          );
          runIds.push(row!.id);
        }
        await tx.query(
          `insert into smp.sessions (player_id, server_run_id, start_ts, end_ts, end_reason, join_event_id, leave_event_id, disconnect_reason)
           select x.player_id, x.server_run_id, x.start_ts, x.end_ts, x.end_reason, x.join_event_id, x.leave_event_id, x.disconnect_reason
           from jsonb_to_recordset($1::jsonb) as x(player_id bigint, server_run_id bigint, start_ts timestamptz, end_ts timestamptz,
             end_reason text, join_event_id bigint, leave_event_id bigint, disconnect_reason text)`,
          [
            JSON.stringify(
              input.sessions.map((s) => ({
                player_id: pid(s.playerKey),
                server_run_id: runIds[s.serverRunIndex] ?? null,
                start_ts: new Date(s.startTs).toISOString(),
                end_ts: new Date(s.endTs).toISOString(),
                end_reason: s.endReason,
                join_event_id: Number(s.joinEventId),
                leave_event_id: s.leaveEventId === null ? null : Number(s.leaveEventId),
                disconnect_reason: s.disconnectReason,
              })),
            ),
          ],
        );

        // 4. Precomputed stats.
        await tx.query("delete from smp.player_stats");
        await tx.query(
          `insert into smp.player_stats (player_id, stats)
           select x.player_id, x.stats from jsonb_to_recordset($1::jsonb) as x(player_id bigint, stats jsonb)`,
          [JSON.stringify([...input.playerStats].map(([key, stats]) => ({ player_id: pid(key), stats })))],
        );
        await tx.query(
          `insert into smp.server_stats (id, stats, computed_at) values (1, $1::jsonb, now())
           on conflict (id) do update set stats = excluded.stats, computed_at = now()`,
          [JSON.stringify(input.serverStats)],
        );
        return { newPlayers };
      });
    },
  };
}

export type IngestStore = ReturnType<typeof createIngestStore>;
