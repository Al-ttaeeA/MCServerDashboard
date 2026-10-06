"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { formatBucketDate, formatDuration } from "@/lib/format";
import { FloatingTip } from "@/components/ui/FloatingTip";

/**
 * GitHub-style activity calendar: one cell per day (weeks as columns,
 * Monday at the top). Sequential encoding in a single hue — the player's
 * colour — from a faint step for "a little" to full strength for the most.
 *
 * Cells scale to fill the available width (between 10 and 28 px), so a
 * short history doesn't sit squeezed in the corner of a wide card.
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<{ date: string; seconds: number; anchor: { x: number; y: number } } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byDate = new Map(daily.map((d) => [d.date, d.seconds]));
  const max = Math.max(1, ...daily.map((d) => d.seconds));

  const end = parse(endDate);
  const endMonday = addDays(end, -((end.getUTCDay() + 6) % 7));
  const start = addDays(endMonday, -(weeks - 1) * 7);
  const left = 28;
  const top = 16;
  const gapRatio = 0.22;
  // Fill the width: cell + gap per column, clamped to a comfortable size.
  const step = width > 0 ? Math.min(34, Math.max(13, (width - left) / weeks)) : 15;
  const cell = Math.round(step * (1 - gapRatio));
  const gap = Math.max(2, Math.round(step - cell));

  const cols: { date: string; seconds: number; inRange: boolean }[][] = [];
  const months: { x: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const iso = day.toISOString().slice(0, 10);
      col.push({ date: iso, seconds: byDate.get(iso) ?? 0, inRange: day <= end });
      if (day.getUTCDate() === 1 || (w === 0 && d === 0)) months.push({ x: left + w * (cell + gap), label: formatBucketDate(iso, { month: "short" }) });
    }
    cols.push(col);
  }
  const svgWidth = left + weeks * (cell + gap);
  const svgHeight = top + 7 * (cell + gap);

  const activate = (c: { date: string; seconds: number }, target: Element) => {
    const r = target.getBoundingClientRect();
    setActive({ ...c, anchor: { x: r.left + r.width / 2, y: r.top } });
  };

  return (
    <div ref={wrapRef}>
      <div className="overflow-x-auto">
        <svg width={svgWidth} height={svgHeight} role="img" aria-label="Daily playtime calendar" className="block">
          {months.map((m, i) =>
            // Skip a label if it would collide with the previous one.
            i > 0 && m.x - months[i - 1]!.x < 28 ? null : (
              <text key={`${m.x}`} x={m.x} y={10} className="fill-ink-3 text-[10px]">
                {m.label}
              </text>
            ),
          )}
          {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) =>
            l ? (
              <text key={l} x={0} y={top + i * (cell + gap) + cell / 2 + 3} className="fill-ink-3 text-[9px]">
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
                  rx={Math.max(2, cell / 6)}
                  fill={c.seconds > 0 ? color : "#171b23"}
                  fillOpacity={c.seconds > 0 ? level(c.seconds / max) : 1}
                  stroke={active?.date === c.date ? "#e9ecf1" : "none"}
                  strokeWidth={1.5}
                  tabIndex={0}
                  aria-label={`${formatBucketDate(c.date, { weekday: "long", month: "long", day: "numeric" })}: ${c.seconds ? formatDuration(c.seconds) : "no play"}`}
                  onPointerEnter={(e) => activate(c, e.currentTarget)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={(e) => activate(c, e.currentTarget)}
                  onBlur={() => setActive(null)}
                />
              ) : null,
            ),
          )}
        </svg>
      </div>
      {active ? (
        <FloatingTip anchor={active.anchor} placement="above" className="whitespace-nowrap">
          <div className="font-semibold">{active.seconds ? formatDuration(active.seconds) : "No play"}</div>
          <div className="text-ink-3">{formatBucketDate(active.date, { weekday: "short", month: "short", day: "numeric" })}</div>
        </FloatingTip>
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
