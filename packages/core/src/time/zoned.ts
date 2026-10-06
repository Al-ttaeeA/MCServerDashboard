/**
 * Minimal, dependency-free timezone helpers built on `Intl`.
 *
 * Why this matters: Minecraft log lines only contain `HH:MM:SS` in the
 * *server's* local time (UTC on WiseHosting). We combine that with the file's
 * date to get a wall-clock time, then convert it to an absolute UTC instant
 * for storage. Display code later converts back to the viewer's timezone.
 */

export interface CivilDate {
  year: number;
  month: number; // 1–12
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a timezone. */
export function zonedParts(instantMs: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instantMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset (ms) of `timeZone` from UTC at a given instant. EDT → -4h. */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant (ms).
 * `dayOffset` adds whole days (used for midnight rollover within a file).
 *
 * For ambiguous times (DST fall-back) the earlier instant is returned; for
 * non-existent times (spring-forward gap) the result is shifted forward.
 */
export function zonedTimeToUtc(
  date: CivilDate,
  secondOfDay: number,
  timeZone: string,
  dayOffset = 0,
): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day + dayOffset, 0, 0, secondOfDay);
  const offset1 = timeZoneOffsetMs(naive, timeZone);
  const guess = naive - offset1;
  const offset2 = timeZoneOffsetMs(guess, timeZone);
  if (offset1 === offset2) return guess;
  // The first guess crossed a DST transition; retry with the other offset.
  const retry = naive - offset2;
  if (timeZoneOffsetMs(retry, timeZone) === offset2) return retry;
  return naive - Math.max(offset1, offset2);
}

/** `YYYY-MM-DD` of an instant in a timezone. */
export function isoDateInZone(instantMs: number, timeZone: string): string {
  const p = zonedParts(instantMs, timeZone);
  return formatIsoDate({ year: p.year, month: p.month, day: p.day });
}

export function secondOfDayInZone(instantMs: number, timeZone: string): number {
  const p = zonedParts(instantMs, timeZone);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

export function parseIsoDate(s: string): CivilDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(d.year, d.month - 1, d.day));
  if (check.getUTCMonth() !== d.month - 1 || check.getUTCDate() !== d.day) return null;
  return d;
}

export function formatIsoDate(d: CivilDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function addDays(d: CivilDate, days: number): CivilDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Throws if the runtime doesn't know the timezone (catches config typos early). */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`Unknown timezone "${timeZone}". Use an IANA name like "UTC" or "America/New_York".`);
  }
}
