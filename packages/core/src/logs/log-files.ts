import {
  addDays,
  formatIsoDate,
  isoDateInZone,
  parseIsoDate,
  secondOfDayInZone,
  type CivilDate,
} from "../time/zoned";

/**
 * How vanilla names its log files (log4j2 config shipped with the server):
 *
 *   logs/latest.log               ← currently being written
 *   logs/2026-10-04-1.log.gz      ← rotated: date + sequence number
 *
 * Rotation happens on server start AND on the first write after midnight
 * (server time). So one file never spans more than one calendar day, and
 * the date in the filename is the day its lines were written. latest.log has
 * no date in its name; we derive it from its modification time.
 */
export type LogFileInfo =
  | { kind: "rotated"; name: string; date: string; seq: number; gzip: boolean }
  | { kind: "latest"; name: string };

const ROTATED_RE = /^(\d{4}-\d{2}-\d{2})-(\d+)\.log(\.gz)?$/;

export function classifyLogFile(name: string): LogFileInfo | null {
  if (name === "latest.log") return { kind: "latest", name };
  const m = ROTATED_RE.exec(name);
  if (!m || !parseIsoDate(m[1]!)) return null;
  return { kind: "rotated", name, date: m[1]!, seq: Number(m[2]), gzip: m[3] !== undefined };
}

/** Chronological order: by date, then sequence; latest.log is always newest. */
export function compareLogFiles(a: LogFileInfo, b: LogFileInfo): number {
  if (a.kind === "latest" || b.kind === "latest") {
    return a.kind === b.kind ? 0 : a.kind === "latest" ? 1 : -1;
  }
  return a.date === b.date ? a.seq - b.seq : a.date < b.date ? -1 : 1;
}

/** Tolerance for clock skew between the log timestamps and file mtime. */
const MTIME_SKEW_SECONDS = 300;

/**
 * Works out which day latest.log's lines belong to.
 *
 * The file's mtime is the time of its last write (≈ its last line). If the
 * last line's time-of-day is clearly *after* the mtime's time-of-day, the
 * mtime must already be past midnight (e.g. last line 23:59:58, mtime
 * 00:00:03 next day), so the content belongs to the previous day.
 */
export function inferLatestLogDate(
  mtimeMs: number,
  lastSecondOfDay: number | null,
  serverTimeZone: string,
): string {
  const date = parseIsoDate(isoDateInZone(mtimeMs, serverTimeZone))!;
  if (lastSecondOfDay === null) return formatIsoDate(date);
  const mtimeSecond = secondOfDayInZone(mtimeMs, serverTimeZone);
  if (lastSecondOfDay > mtimeSecond + MTIME_SKEW_SECONDS) {
    return formatIsoDate(addDays(date, -1));
  }
  return formatIsoDate(date);
}

export function logFileDate(info: LogFileInfo, latestDate: string): CivilDate {
  return parseIsoDate(info.kind === "rotated" ? info.date : latestDate)!;
}
