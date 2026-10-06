import { MATCHERS, stripSystemChat, type MatchContext } from "./matchers";
import { isContinuationLine, tokenizeLine } from "./tokenize";
import type { ParseIssue, ParseResult, ParsedEvent } from "./types";

export interface ParseOptions {
  /**
   * Player names already known (e.g. loaded from the database). Names from
   * `UUID of player …` lines in this file are added as they're seen.
   */
  knownPlayers?: Iterable<string>;
  /**
   * `latest.log` may be mid-write when we download it. When true (default),
   * a final line without a trailing newline is skipped; it'll be picked up
   * complete on the next sync.
   */
  dropIncompleteLastLine?: boolean;
}

/**
 * A backwards jump bigger than this is treated as passing midnight. Smaller
 * jumps (clock corrections) are tolerated without changing the day.
 */
const ROLLOVER_THRESHOLD_SECONDS = 3600;

/**
 * Parses the full text of one log file.
 *
 * Pure and deterministic: the same text always yields the same events with
 * the same line numbers, which is what makes ingestion idempotent.
 */
export function parseLog(text: string, options: ParseOptions = {}): ParseResult {
  const lines = text.split("\n");
  // A trailing "\n" produces one empty final element — not a real line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  else if ((options.dropIncompleteLastLine ?? true) && lines.length > 0) lines.pop();

  const known = new Set(options.knownPlayers ?? []);
  const ctx: MatchContext = { knownPlayers: known };

  const events: ParsedEvent[] = [];
  const issues: ParseIssue[] = [];
  let ignoredLines = 0;
  let continuationLines = 0;
  let dayOffset = 0;
  let prevSecond: number | null = null;
  let firstSecond: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.replace(/\r$/, "");
    const lineNo = i + 1;

    const line = tokenizeLine(raw);
    if (!line) {
      if (isContinuationLine(raw)) continuationLines++;
      else issues.push({ lineNo, reason: "malformed_line", raw: truncate(raw) });
      continue;
    }

    if (prevSecond !== null && line.secondOfDay < prevSecond - ROLLOVER_THRESHOLD_SECONDS) {
      dayOffset++;
      issues.push({ lineNo, reason: "time_went_backwards", raw: truncate(raw) });
    }
    prevSecond = line.secondOfDay;
    firstSecond ??= line.secondOfDay;

    let matched = false;
    for (const matcher of MATCHERS) {
      const result = matcher.match(line.message, line, ctx);
      if (result === null) continue;
      matched = true;
      if (result !== "ignore") {
        events.push({ lineNo, dayOffset, secondOfDay: line.secondOfDay, event: result });
        if (result.type === "PLAYER_UUID" || result.type === "JOIN") known.add(result.player);
      } else {
        ignoredLines++;
      }
      break;
    }
    if (matched) continue;

    if (looksLikeUnrecognizedPlayerMessage(line.message, line.thread, line.level, known)) {
      issues.push({ lineNo, reason: "unrecognized_player_message", raw: truncate(raw) });
    } else {
      ignoredLines++;
    }
  }

  return {
    events,
    issues,
    ignoredLines,
    continuationLines,
    totalLines: lines.length,
    firstSecondOfDay: firstSecond,
    lastSecondOfDay: prevSecond,
    lastDayOffset: dayOffset,
  };
}

/**
 * Broadcast messages that start with a known player's name but matched
 * nothing are almost always a death message we don't have a template for
 * (new damage type after a Minecraft update). Those are worth surfacing.
 * Ordinary server noise (`Player X standing on air`, WARN lines) is not.
 */
function looksLikeUnrecognizedPlayerMessage(
  message: string,
  thread: string,
  level: string,
  known: ReadonlySet<string>,
): boolean {
  const { text, isSystemChat } = stripSystemChat(message);
  if (!isSystemChat && !(thread === "Server thread" && level === "INFO")) return false;
  const space = text.indexOf(" ");
  if (space === -1) return false;
  return known.has(text.slice(0, space));
}

/**
 * Issues are stored and printed in (public) CI output, so IP addresses are
 * redacted and very long lines are cut.
 */
function truncate(s: string): string {
  const redacted = redactIps(s);
  return redacted.length > 500 ? redacted.slice(0, 500) + "…" : redacted;
}

export function redactIps(s: string): string {
  return s
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "<ip>")
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b(?::\d+)?/gi, "<ip>");
}
