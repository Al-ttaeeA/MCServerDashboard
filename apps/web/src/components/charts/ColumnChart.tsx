"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { FloatingTip } from "@/components/ui/FloatingTip";

export interface ColumnDatum {
  key: string;
  /** Axis label (may be empty to skip). */
  label: string;
  value: number;
  /** Tooltip title, e.g. the full date. */
  title: string;
}

/**
 * Single-series column chart (SVG). Bars are capped at 24px, rounded at the
 * data end and square at the baseline; hairline gridlines; per-bar hover and
 * focus tooltip. One series → no legend; the section title names it.
 */
export function ColumnChart({
  data,
  color,
  height = 160,
  formatValue,
  formatTick = formatValue,
  ariaLabel,
  durationAxis = false,
}: {
  data: ColumnDatum[];
  color: string;
  height?: number;
  formatValue: (v: number) => string;
  formatTick?: (v: number) => string;
  ariaLabel: string;
  /** Values are seconds: round the axis to clean hours/minutes. */
  durationAxis?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = { top: 8, right: 4, bottom: 22, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const rawMax = Math.max(0, ...data.map((d) => d.value));
  const unit = durationAxis ? (rawMax >= 3600 ? 3600 : 60) : 1;
  const max = niceMax(rawMax / unit) * unit;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(1.5, Math.min(24, slot - 2)); // 2px surface gap between neighbours
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const activeDatum = active !== null ? data[active] : undefined;
  /** Anchor the tooltip just above the bar (or the baseline for empty slots), in viewport coordinates. */
  const activate = (i: number, slotEl: Element, barHeight: number) => {
    const r = slotEl.getBoundingClientRect();
    setActive(i);
    setAnchor({ x: r.left + r.width / 2, y: r.bottom - barHeight });
  };

  return (
    <div ref={wrapRef} className="relative">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block" role="img" aria-labelledby={`${id}-t`}>
        <title id={`${id}-t`}>{ariaLabel}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={Math.round(y(t)) + 0.5} y2={Math.round(y(t)) + 0.5} stroke="#1c212a" strokeWidth={1} />
            <text x={pad.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-ink-3 text-[10px] tabular">
              {formatTick(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * innerH);
          const x = pad.left + i * slot + (slot - barW) / 2;
          return (
            <g key={d.key}>
              {/* Hit target: the whole slot, taller than the bar. */}
              <rect
                x={pad.left + i * slot}
                y={pad.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.title}: ${formatValue(d.value)}`}
                onPointerEnter={(e) => activate(i, e.currentTarget, h)}
                onPointerLeave={() => setActive(null)}
                onFocus={(e) => activate(i, e.currentTarget, h)}
                onBlur={() => setActive(null)}
              />
              {h > 0 ? (
                <path
                  d={roundedTopBar(x, y(0) - h, barW, h, Math.min(4, barW / 2, h))}
                  fill={color}
                  opacity={active === null || active === i ? 1 : 0.45}
                  pointerEvents="none"
                />
              ) : null}
              {d.label ? (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[10px]" pointerEvents="none">
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {activeDatum && anchor ? (
        <FloatingTip anchor={anchor} placement="above" className="whitespace-nowrap">
          <div className="font-semibold text-ink">{formatValue(activeDatum.value)}</div>
          <div className="text-ink-3">{activeDatum.title}</div>
        </FloatingTip>
      ) : null}
    </div>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Rounds the axis max up to a clean number. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * exp;
}
