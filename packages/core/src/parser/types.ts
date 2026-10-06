/**
 * Events the parser can extract from a vanilla Minecraft server log.
 *
 * Every event here is *directly observed* in the log. Anything derived from
 * these (sessions, playtime, streaks, …) lives elsewhere.
 */

export type AdvancementKind = "task" | "challenge" | "goal";

export type LogEvent =
  /** `Starting minecraft server version 26.3` — a new server process. */
  | { type: "SERVER_START"; version: string }
  /** `Done (2.591s)! For help, type "help"` — server finished starting. */
  | { type: "SERVER_READY"; startupSeconds: number }
  /** `Stopping server` — clean shutdown (via /stop or the panel). */
  | { type: "SERVER_STOP" }
  /** `Server empty for 60 seconds, pausing` — tick loop paused, nobody online. */
  | { type: "SERVER_PAUSE" }
  /** `UUID of player X is <uuid>` — logged by the authenticator on every login. */
  | { type: "PLAYER_UUID"; player: string; uuid: string }
  /** `X[/ip:port] logged in with entity id N at (x, y, z)` — IP is intentionally dropped. */
  | { type: "PLAYER_LOGIN"; player: string; x: number; y: number; z: number }
  /** `X joined the game` / `X (formerly known as Y) joined the game`. */
  | { type: "JOIN"; player: string; formerName?: string }
  /** `X left the game`. */
  | { type: "LEAVE"; player: string }
  /** `X lost connection: <reason>` — precedes LEAVE; carries the disconnect reason. */
  | { type: "DISCONNECT"; player: string; reason: string }
  /** A vanilla death message, e.g. `X was slain by Zombie`. */
  | {
      type: "DEATH";
      player: string;
      message: string;
      /** Translation key suffix, e.g. `attack.mob`, `fell.accident.generic`. */
      cause: string;
      killer?: string;
      weapon?: string;
    }
  /** `X has made the advancement [Y]` (also challenge / goal variants). */
  | { type: "ADVANCEMENT"; player: string; advancement: string; kind: AdvancementKind }
  /** `<X> message` — we record only *that* a player chatted, never the content. */
  | { type: "CHAT"; player: string };

export type LogEventType = LogEvent["type"];

export const LOG_EVENT_TYPES = [
  "SERVER_START",
  "SERVER_READY",
  "SERVER_STOP",
  "SERVER_PAUSE",
  "PLAYER_UUID",
  "PLAYER_LOGIN",
  "JOIN",
  "LEAVE",
  "DISCONNECT",
  "DEATH",
  "ADVANCEMENT",
  "CHAT",
] as const satisfies readonly LogEventType[];

/** A tokenized log line: `[HH:MM:SS] [thread/LEVEL]: message`. */
export interface LogLine {
  /** Seconds since local midnight (server timezone). */
  secondOfDay: number;
  thread: string;
  level: string;
  message: string;
}

export type ParseIssueReason =
  /** Line has no recognizable `[HH:MM:SS] [...]` header and isn't a stack trace. */
  | "malformed_line"
  /** A broadcast message about a known player that no matcher understood (likely a new death message). */
  | "unrecognized_player_message"
  /** Timestamps went backwards inside a file — a midnight rollover we didn't expect. */
  | "time_went_backwards";

export interface ParseIssue {
  lineNo: number;
  reason: ParseIssueReason;
  raw: string;
}

export interface ParsedEvent {
  /** 1-based line number within the file — part of the event's idempotency key. */
  lineNo: number;
  /** Day offset from the file's start date (normally 0; >0 only on unexpected rollover). */
  dayOffset: number;
  secondOfDay: number;
  event: LogEvent;
}

export interface ParseResult {
  events: ParsedEvent[];
  issues: ParseIssue[];
  /** Lines that were well-formed but carry nothing we track (chunk saves, warnings, …). */
  ignoredLines: number;
  /** Stack-trace / continuation lines with no header. */
  continuationLines: number;
  totalLines: number;
  /** Time of day of the last timestamped line (useful for dating latest.log). */
  lastSecondOfDay: number | null;
  firstSecondOfDay: number | null;
}
