import type { MetricUnit } from "./types";

/**
 * Deterministic, locale-independent formatting for award text (it's
 * generated at sync time, not in the viewer's browser).
 */

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${fmtInt(h)}h` : `${fmtInt(h)}h ${m}m`;
}

export function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtNumber(n: number, digits = 1): string {
  if (Math.abs(n) >= 100) return fmtInt(n);
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export const fmtPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** Hours after noon → "3:15 AM". */
export function fmtClock(hoursAfterNoon: number): string {
  const totalMin = Math.round((((hoursAfterNoon + 12) % 24) + 24) % 24 * 60) % (24 * 60);
  const h24 = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

export function fmtValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case "duration":
      return fmtDuration(value);
    case "hours":
      return fmtDuration(value * 3600);
    case "count":
      return fmtInt(value);
    case "ratio":
      return fmtPercent(value);
    case "per_hour":
      return fmtNumber(value, value < 1 ? 2 : 1);
    case "days":
      return `${fmtInt(value)} ${Math.round(value) === 1 ? "day" : "days"}`;
    case "km":
      return `${fmtNumber(value, 1)} km`;
    case "clock":
      return fmtClock(value);
    case "score":
      return fmtNumber(value, 2);
  }
}

/** "3.4× the server median", "half the server median", "while everyone else is at zero". */
export function fmtComparison(value: number, median: number, unit: MetricUnit): string {
  if (unit === "clock") {
    const diffH = value - median;
    const mins = Math.round(Math.abs(diffH) * 60);
    const span = mins >= 90 ? `${fmtNumber(mins / 60, 1)} hours` : `${mins} minutes`;
    return diffH >= 0 ? `${span} later than the server's typical time` : `${span} earlier than the server's typical time`;
  }
  if (median === 0) return value === 0 ? "the same as everyone else" : "while the rest of the server is at zero";
  const ratio = value / median;
  if (ratio >= 1.15) return `${fmtNumber(ratio, ratio >= 10 ? 0 : 1)}× the server median`;
  if (ratio <= 0.87) {
    if (ratio < 0.05) return `a tiny fraction of the server median (${fmtValue(median, unit)})`;
    return `${fmtPercent(ratio)} of the server median`;
  }
  return `close to the server median of ${fmtValue(median, unit)}`;
}
