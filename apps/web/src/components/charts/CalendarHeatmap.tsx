"use client";

import { useState } from "react";
import { formatBucketDate, formatDuration } from "@/lib/format";

/**
 * GitHub-style activity calendar: one cell per day (weeks as columns,
 * Monday at the top). Sequential encoding in a single hue — the player's
 * colour — from a faint step for "a little" to full strength for the most.
 */
export function CalendarHeatmap({
  daily,
  color,
  endDate,
  weeks = 26,
}: {
  daily: { date: string; seconds: number }[];
  color: string;
  /** `YYYY-MM-DD` of the last day shown. */
  endDate: string;
  weeks?: number;
}) {
  const [active, setActive] = useState<{ date: string; seconds: number; x: number; y: number } | null>(null);
  const byDate = new Map(daily.map((d) => [d.date, d.seconds]));
  const max = Math.max(1, ...daily.map((d) => d.seconds));

  const end = parse(endDate);
  const endMonday = addDays(end, -((end.getUTCDay() + 6) % 7));
  const start = addDays(endMonday, -(weeks - 1) * 7);
  const cell = 12;
  const gap = 3;
  const left = 26;
  const top = 16;

  const cols: { date: string; seconds: number; inRange: boolean }[][] = [];
  const months: { x: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const iso = day.toISOString().slice(0, 10);
      col.push({ date: iso, seconds: byDate.get(iso) ?? 0, inRange: day <= end });
      if (day.getUTCDate() === 1) months.push({ x: left + w * (cell + gap), label: formatBucketDate(iso, { month: "short" }) });
    }
    cols.push(col);
  }
  const width = left + weeks * (cell + gap);
  const height = top + 7 * (cell + gap);

  return (
    <div className="relative overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Daily playtime calendar" className="block">
        {months.map((m) => (
          <text key={`${m.x}`} x={m.x} y={10} className="fill-ink-3 text-[10px]">
            {m.label}
          </text>
        ))}
        {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) =>
          l ? (
            <text key={l} x={0} y={top + i * (cell + gap) + cell - 2} className="fill-ink-3 text-[9px]">
              {l}
            </text>
          ) : null,
        )}
        {cols.map((col, w) =>
          col.map((c, d) =>
            c.inRange ? (
              <rect
                key={c.date}
                x={left + w * (cell + gap)}
                y={top + d * (cell + gap)}
                width={cell}
                height={cell}
                rx={2}
                fill={c.seconds > 0 ? color : "#171b23"}
                fillOpacity={c.seconds > 0 ? level(c.seconds / max) : 1}
                tabIndex={0}
                aria-label={`${formatBucketDate(c.date, { weekday: "long", month: "long", day: "numeric" })}: ${c.seconds ? formatDuration(c.seconds) : "no play"}`}
                onPointerEnter={() => setActive({ ...c, x: left + w * (cell + gap), y: top + d * (cell + gap) })}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive({ ...c, x: left + w * (cell + gap), y: top + d * (cell + gap) })}
                onBlur={() => setActive(null)}
              />
            ) : null,
          ),
        )}
      </svg>
      {active ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-[var(--shadow-pop)]"
          style={{ left: active.x + cell / 2, top: active.y - 4 }}
        >
          <div className="font-semibold">{active.seconds ? formatDuration(active.seconds) : "No play"}</div>
          <div className="text-ink-3">{formatBucketDate(active.date, { weekday: "short", month: "short", day: "numeric" })}</div>
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink-3">
        Less
        {[0.25, 0.45, 0.7, 1].map((o) => (
          <span key={o} className="inline-block size-2.5 rounded-[2px]" style={{ background: color, opacity: o }} />
        ))}
        More
      </div>
    </div>
  );
}

/** Four discrete steps so differences are readable (continuous opacity isn't). */
function level(ratio: number): number {
  return ratio > 0.75 ? 1 : ratio > 0.45 ? 0.7 : ratio > 0.2 ? 0.45 : 0.25;
}

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}
