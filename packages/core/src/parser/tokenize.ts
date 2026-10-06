import type { LogLine } from "./types";

/**
 * Tokenizes one log line into time / thread / level / message.
 *
 * Vanilla's log4j pattern is `[%d{HH:mm:ss}] [%t/%level]: %msg`. We parse it
 * by position and delimiter instead of a single big regex, so thread names
 * containing spaces, `#` or `/` (e.g. `User Authenticator #1`) work.
 *
 * Also accepts the older/alternative `[HH:mm:ss LEVEL]: msg` layout so a
 * future format tweak degrades gracefully instead of breaking everything.
 *
 * Returns `null` when the line has no header (stack traces, wrapped output).
 */
export function tokenizeLine(line: string): LogLine | null {
  if (line.length < 12 || line[0] !== "[") return null;

  const secondOfDay = parseClock(line, 1);
  if (secondOfDay === null) return null;

  // Variant A: `[HH:MM:SS] [thread/LEVEL]: msg`
  if (line.startsWith("] [", 9)) {
    const headerEnd = line.indexOf("]: ", 12);
    if (headerEnd === -1) return null;
    const header = line.slice(12, headerEnd);
    const slash = header.lastIndexOf("/");
    if (slash <= 0) return null;
    return {
      secondOfDay,
      thread: header.slice(0, slash),
      level: header.slice(slash + 1),
      message: line.slice(headerEnd + 3),
    };
  }

  // Variant B: `[HH:MM:SS LEVEL]: msg`
  if (line[9] === " ") {
    const headerEnd = line.indexOf("]: ", 10);
    if (headerEnd === -1) return null;
    return {
      secondOfDay,
      thread: "",
      level: line.slice(10, headerEnd),
      message: line.slice(headerEnd + 3),
    };
  }

  return null;
}

/** Parses `HH:MM:SS` starting at `offset`. Returns seconds since midnight or null. */
function parseClock(s: string, offset: number): number | null {
  if (s[offset + 2] !== ":" || s[offset + 5] !== ":") return null;
  const h = twoDigits(s, offset);
  const m = twoDigits(s, offset + 3);
  const sec = twoDigits(s, offset + 6);
  if (h === null || m === null || sec === null) return null;
  if (h > 23 || m > 59 || sec > 59) return null;
  return h * 3600 + m * 60 + sec;
}

function twoDigits(s: string, i: number): number | null {
  const a = s.charCodeAt(i) - 48;
  const b = s.charCodeAt(i + 1) - 48;
  if (a < 0 || a > 9 || b < 0 || b > 9) return null;
  return a * 10 + b;
}

/**
 * Lines without a header that are part of a multi-line log entry
 * (Java stack traces, exception class names, `Caused by:` …).
 */
export function isContinuationLine(line: string): boolean {
  if (line.length === 0) return true;
  const c = line[0];
  if (c === "\t" || c === " ") return true;
  if (line.startsWith("Caused by:") || line.startsWith("Suppressed:")) return true;
  // e.g. `io.netty.channel.StacklessClosedChannelException`
  return /^[a-z][\w$]*(\.[\w$]+)+(:|$)/.test(line);
}
