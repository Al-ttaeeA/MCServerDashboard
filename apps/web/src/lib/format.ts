/** Display formatting. Everything renders in the viewer's local timezone. */

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return s === 0 ? "0m" : "<1m";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h.toLocaleString()}h` : `${h.toLocaleString()}h ${m}m`;
}

/** Compact for axes and tight spaces: 1.5h, 42m. */
export function formatDurationCompact(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = seconds / 3600;
  return `${h >= 10 ? Math.round(h) : Math.round(h * 10) / 10}h`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dateOnly = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekdayDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });

type DateInput = string | number | Date;
export const formatDateTime = (d: DateInput) => dateTime.format(new Date(d));
export const formatDate = (d: DateInput) => dateOnly.format(new Date(d));
export const formatTime = (d: DateInput) => timeOnly.format(new Date(d));
export const formatWeekdayDate = (d: DateInput) => weekdayDate.format(new Date(d));

/**
 * Formats a stats bucket date (`YYYY-MM-DD`). Buckets are already in the
 * community timezone, so render the calendar date as-is (via UTC) instead of
 * shifting it into the viewer's timezone.
 */
export function formatBucketDate(date: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

export function formatRange(start: DateInput, end: DateInput): string {
  const a = new Date(start);
  const b = new Date(end);
  return a.toDateString() === b.toDateString()
    ? `${formatWeekdayDate(a)}, ${formatTime(a)} – ${formatTime(b)}`
    : `${formatDateTime(a)} – ${formatDateTime(b)}`;
}

export function formatRelative(d: DateInput, now = Date.now()): string {
  const diff = (now - new Date(d).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  const days = Math.round(diff / 86400);
  return days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : formatDate(d);
}

export const formatNumber = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

export function formatHour(hour: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));
}

export type StatUnit = "duration" | "count" | "rate" | "ratio" | "days";

export function formatStatValue(value: number, unit: StatUnit): string {
  switch (unit) {
    case "duration":
      return formatDuration(value);
    case "count":
      return formatNumber(value);
    case "rate":
      return formatNumber(value, 2);
    case "ratio":
      return formatPercent(value);
    case "days":
      return `${formatNumber(value)} ${value === 1 ? "day" : "days"}`;
  }
}
