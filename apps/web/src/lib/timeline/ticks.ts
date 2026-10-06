/**
 * Axis ticks that adapt to the zoom level: years → months → weeks → days →
 * hours → minutes. Ticks fall on round boundaries in the *viewer's* local
 * time (via the standard Date local-time setters), so "6 PM" means 6 PM for
 * whoever is looking.
 */

type Unit = "minute" | "hour" | "day" | "month" | "year";

interface Step {
  unit: Unit;
  n: number;
  approxMs: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const STEPS: readonly Step[] = [
  { unit: "minute", n: 1, approxMs: MIN },
  { unit: "minute", n: 5, approxMs: 5 * MIN },
  { unit: "minute", n: 15, approxMs: 15 * MIN },
  { unit: "minute", n: 30, approxMs: 30 * MIN },
  { unit: "hour", n: 1, approxMs: HOUR },
  { unit: "hour", n: 3, approxMs: 3 * HOUR },
  { unit: "hour", n: 6, approxMs: 6 * HOUR },
  { unit: "hour", n: 12, approxMs: 12 * HOUR },
  { unit: "day", n: 1, approxMs: DAY },
  { unit: "day", n: 2, approxMs: 2 * DAY },
  { unit: "day", n: 7, approxMs: 7 * DAY },
  { unit: "month", n: 1, approxMs: 30 * DAY },
  { unit: "month", n: 3, approxMs: 91 * DAY },
  { unit: "year", n: 1, approxMs: 365 * DAY },
];

export interface Tick {
  t: number;
  label: string;
  /** Day / month / year boundary — drawn as a stronger gridline. */
  major: boolean;
}

export function pickStep(spanMs: number, widthPx: number, minPx = 84): Step {
  for (const s of STEPS) if ((s.approxMs / spanMs) * widthPx >= minPx) return s;
  return STEPS[STEPS.length - 1]!;
}

function floorTo(t: number, step: Step): Date {
  const d = new Date(t);
  d.setSeconds(0, 0);
  switch (step.unit) {
    case "minute":
      d.setMinutes(Math.floor(d.getMinutes() / step.n) * step.n);
      break;
    case "hour":
      d.setMinutes(0);
      d.setHours(Math.floor(d.getHours() / step.n) * step.n);
      break;
    case "day":
      d.setHours(0, 0);
      if (step.n === 7) d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
      break;
    case "month":
      d.setHours(0, 0);
      d.setDate(1);
      d.setMonth(Math.floor(d.getMonth() / step.n) * step.n);
      break;
    case "year":
      d.setHours(0, 0);
      d.setMonth(0, 1);
      break;
  }
  return d;
}

function advance(d: Date, step: Step): Date {
  const n = new Date(d);
  switch (step.unit) {
    case "minute":
      n.setMinutes(n.getMinutes() + step.n);
      break;
    case "hour":
      n.setHours(n.getHours() + step.n);
      break;
    case "day":
      n.setDate(n.getDate() + step.n);
      break;
    case "month":
      n.setMonth(n.getMonth() + step.n);
      break;
    case "year":
      n.setFullYear(n.getFullYear() + step.n);
      break;
  }
  return n;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts);
const F = {
  time: fmt({ hour: "numeric", minute: "2-digit" }),
  hour: fmt({ hour: "numeric" }),
  weekday: fmt({ weekday: "short" }),
  dayNum: fmt({ day: "numeric" }),
  monthDay: fmt({ month: "short", day: "numeric" }),
  month: fmt({ month: "short" }),
  monthYear: fmt({ month: "short", year: "numeric" }),
  year: fmt({ year: "numeric" }),
};

function label(d: Date, step: Step): { label: string; major: boolean } {
  const midnight = d.getHours() === 0 && d.getMinutes() === 0;
  switch (step.unit) {
    case "minute":
      return midnight ? { label: F.monthDay.format(d), major: true } : { label: F.time.format(d), major: false };
    case "hour":
      return midnight ? { label: `${F.weekday.format(d)} ${F.dayNum.format(d)}`, major: true } : { label: F.hour.format(d), major: false };
    case "day":
      return d.getDate() === 1 ? { label: F.monthYear.format(d), major: true } : { label: F.monthDay.format(d), major: false };
    case "month":
      return d.getMonth() === 0 ? { label: F.year.format(d), major: true } : { label: F.month.format(d), major: false };
    case "year":
      return { label: F.year.format(d), major: true };
  }
}

export function generateTicks(start: number, end: number, widthPx: number): Tick[] {
  if (!(end > start) || widthPx <= 0) return [];
  const step = pickStep(end - start, widthPx);
  const ticks: Tick[] = [];
  for (let d = floorTo(start, step); d.getTime() <= end && ticks.length < 500; d = advance(d, step)) {
    if (d.getTime() < start) continue;
    ticks.push({ t: d.getTime(), ...label(d, step) });
  }
  return ticks;
}

/** Local midnights in (start, end], for day separators. Empty when zoomed too far out to matter. */
export function dayBoundaries(start: number, end: number, maxDays = 120): number[] {
  if ((end - start) / DAY > maxDays) return [];
  const out: number[] = [];
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  for (d.setDate(d.getDate() + 1); d.getTime() <= end; d.setDate(d.getDate() + 1)) out.push(d.getTime());
  return out;
}
