import { zonedParts } from "../time/zoned";

export interface LocalSlice {
  /** `YYYY-MM-DD` in the bucketing timezone. */
  date: string;
  hour: number;
  /** Monday = 0 … Sunday = 6. */
  weekday: number;
  /** Seconds into the local hour where this slice starts (0 unless the session began mid-hour). */
  startSecond: number;
  seconds: number;
}

/**
 * Splits [startMs, endMs) at local hour boundaries in `timeZone` and calls
 * `fn` for each piece. This is what keeps daily/hourly stats on the right
 * local day: a session from 23:30 to 01:15 contributes 30 min to one date
 * and 75 min to the next. DST-safe because boundaries are computed from
 * local wall-clock parts rather than fixed 3600s steps.
 */
export function forEachLocalHour(
  startMs: number,
  endMs: number,
  timeZone: string,
  fn: (slice: LocalSlice) => void,
): void {
  let t = startMs;
  while (t < endMs) {
    const p = zonedParts(t, timeZone);
    const msIntoHour = (p.minute * 60 + p.second) * 1000 + (t % 1000);
    const next = Math.min(endMs, t + 3_600_000 - msIntoHour);
    const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    fn({ date, hour: p.hour, weekday: mondayIndex(p.year, p.month, p.day), startSecond: msIntoHour / 1000, seconds: (next - t) / 1000 });
    t = next;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function mondayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** Whole days between two `YYYY-MM-DD` strings. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}
