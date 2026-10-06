import type { LogEvent } from "../parser/types";

/**
 * Session reconstruction.
 *
 * Input: every event from every log file, in chronological order, with an
 * absolute UTC timestamp and a resolved player key (see `resolvePlayers`).
 * Output: player sessions and server runs.
 *
 * This is a pure function of its input. The ingester re-runs it over the
 * full event history on every sync, so sessions can never drift out of sync
 * with events, and re-importing the same logs yields identical sessions.
 */

export type SessionEndReason =
  /** `X left the game`. */
  | "leave"
  /** Clean `Stopping server` while the player was online. */
  | "server_stop"
  /** Server started again without a stop: crashed or killed. End time = last log line of that run (estimated). */
  | "crash"
  /** `Server empty for N seconds` while we still thought someone was online — a leave we missed. */
  | "inferred_empty"
  /** Joined again without a leave in between; the earlier session is closed at the new join. */
  | "rejoin"
  /** Still online at the end of the available logs. */
  | "open";

/** End reasons whose end time is an approximation rather than an observed event. */
export const ESTIMATED_END_REASONS: ReadonlySet<SessionEndReason> = new Set(["crash", "inferred_empty", "open"]);

export type ServerRunEndReason = "stop" | "crash" | "open";

export type TimelineItem =
  | {
      kind: "event";
      /** Stable event id (DB id or `file:line`). */
      id: string;
      ts: number;
      event: LogEvent;
      /** Resolved player identity for events that have a player. */
      playerKey?: string;
    }
  /** Any timestamped log line (e.g. the last line of each file) — proves the server was alive at `ts`. */
  | { kind: "heartbeat"; ts: number };

export interface BuiltSession {
  playerKey: string;
  startTs: number;
  endTs: number;
  endReason: SessionEndReason;
  joinEventId: string;
  leaveEventId: string | null;
  /** From the preceding `lost connection: …` line, e.g. `Timed out`. */
  disconnectReason: string | null;
  serverRunIndex: number;
}

export interface BuiltServerRun {
  index: number;
  startTs: number;
  endTs: number;
  endReason: ServerRunEndReason;
  version: string | null;
  /** null when logs begin mid-run (no `Starting minecraft server` seen). */
  startEventId: string | null;
}

export interface BuildResult {
  sessions: BuiltSession[];
  serverRuns: BuiltServerRun[];
}

/** Matches vanilla's `Server empty for 60 seconds, pausing`. */
const PAUSE_EMPTY_SECONDS = 60;

interface OpenSession {
  startTs: number;
  joinEventId: string;
  disconnectReason: string | null;
  runIndex: number;
}

export function buildSessions(items: readonly TimelineItem[]): BuildResult {
  const sessions: BuiltSession[] = [];
  const runs: BuiltServerRun[] = [];
  const online = new Map<string, OpenSession>();
  let run: BuiltServerRun | null = null;
  let lastTs: number | null = null;

  const close = (playerKey: string, endTs: number, endReason: SessionEndReason, leaveEventId: string | null) => {
    const s = online.get(playerKey);
    if (!s) return;
    online.delete(playerKey);
    sessions.push({
      playerKey,
      startTs: s.startTs,
      endTs: Math.max(endTs, s.startTs),
      endReason,
      joinEventId: s.joinEventId,
      leaveEventId,
      disconnectReason: s.disconnectReason,
      serverRunIndex: s.runIndex,
    });
  };
  const closeAll = (endTs: number, reason: SessionEndReason) => {
    for (const key of [...online.keys()]) close(key, endTs, reason, null);
  };
  const ensureRun = (ts: number): BuiltServerRun => {
    if (!run) {
      run = { index: runs.length, startTs: ts, endTs: ts, endReason: "open", version: null, startEventId: null };
      runs.push(run);
    }
    return run;
  };

  for (const item of items) {
    const ts = item.ts;
    if (item.kind === "heartbeat") {
      // A plain log line only extends a run that's already in progress. It
      // must not start one: lines after a stop, or from a server that never
      // finished starting (e.g. EULA not accepted), aren't a running server.
      if (run) run.endTs = Math.max(run.endTs, ts);
      lastTs = ts;
      continue;
    }

    const e = item.event;
    if (e.type === "SERVER_START") {
      if (run) {
        // A new process started while the previous run never logged a stop → crash.
        const crashedAt = lastTs ?? ts;
        closeAll(crashedAt, "crash");
        run.endTs = crashedAt;
        run.endReason = "crash";
      }
      run = { index: runs.length, startTs: ts, endTs: ts, endReason: "open", version: e.version, startEventId: item.id };
      runs.push(run);
      lastTs = ts;
      continue;
    }

    const current = ensureRun(ts);
    current.endTs = Math.max(current.endTs, ts);
    lastTs = ts;

    switch (e.type) {
      case "SERVER_STOP":
        closeAll(ts, "server_stop");
        current.endReason = "stop";
        run = null;
        break;
      case "SERVER_PAUSE":
        closeAll(ts - PAUSE_EMPTY_SECONDS * 1000, "inferred_empty");
        break;
      case "JOIN": {
        const key = item.playerKey;
        if (!key) break;
        close(key, ts, "rejoin", null);
        online.set(key, { startTs: ts, joinEventId: item.id, disconnectReason: null, runIndex: current.index });
        break;
      }
      case "DISCONNECT": {
        const s = item.playerKey ? online.get(item.playerKey) : undefined;
        if (s) s.disconnectReason = e.reason;
        break;
      }
      case "LEAVE":
        // A leave without a matching join (e.g. logs start mid-session) is ignored.
        if (item.playerKey) close(item.playerKey, ts, "leave", item.id);
        break;
      default:
        break;
    }
  }

  if (lastTs !== null) closeAll(lastTs, "open");
  sessions.sort((a, b) => a.startTs - b.startTs || a.playerKey.localeCompare(b.playerKey));
  return { sessions, serverRuns: runs };
}
