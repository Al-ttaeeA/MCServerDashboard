"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PlayerRefDto } from "@smp/core";
import { onlineAt, sessionNear, type Interval, type TimelineRow } from "@/lib/timeline/model";
import {
  boundsFor,
  clampViewport,
  panBy,
  span,
  wheelZoomFactor,
  xToTime,
  zoomAt,
  type Viewport,
} from "@/lib/timeline/viewport";
import { formatDateTime, formatDuration, formatRange } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { Avatar, OnlineBadge } from "@/components/ui/primitives";
import { LAYOUT, canvasHeight, plotTop, render } from "./render";

export interface ActivityTimelineProps {
  rows: TimelineRow[];
  extent: { start: number; end: number };
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  onlineIds?: ReadonlySet<string>;
  /** Row label / row click. Receives a screen anchor for positioning a popover. */
  onSelectPlayer?: (player: PlayerRefDto, anchor: { x: number; y: number }) => void;
  showStrip?: boolean;
  /** Narrow label column (player page / mobile). */
  compactLabels?: boolean;
  /** Hide the hover readout (e.g. while a popover is open). */
  suppressHover?: boolean;
  ariaLabel: string;
}

const END_REASON_NOTE: Record<string, string> = {
  crash: "End time estimated — the server crashed or was killed",
  inferred_empty: "End time estimated — leave wasn't logged",
  rejoin: "Ended by reconnecting",
  server_stop: "Ended when the server stopped",
};

interface Hover {
  x: number;
  y: number;
  rowIndex: number | null;
  session: Interval | null;
  time: number;
}

export function ActivityTimeline({
  rows,
  extent,
  viewport,
  onViewportChange,
  onlineIds,
  onSelectPlayer,
  showStrip = true,
  compactLabels = false,
  suppressHover = false,
  ariaLabel,
}: ActivityTimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [dragging, setDragging] = useState(false);
  const now = useNow();
  const bounds = useMemo(() => boundsFor(extent.start, Math.max(extent.end, now)), [extent.start, extent.end, now]);

  // Latest values for native event handlers (wheel) without re-subscribing.
  const viewportRef = useRef(viewport);
  const boundsRef = useRef(bounds);
  useLayoutEffect(() => {
    viewportRef.current = viewport;
    boundsRef.current = bounds;
  }, [viewport, bounds]);
  const height = canvasHeight(rows.length, showStrip);
  const top = plotTop(showStrip);

  const setViewport = useCallback(
    (next: Viewport) => onViewportChange(clampViewport(next, boundsRef.current)),
    [onViewportChange],
  );

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw (coalesced into one frame).
  const fontsVersion = useFontsReady();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const frame = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, {
        rows,
        viewport,
        width,
        height,
        showStrip,
        now,
        fonts: resolveFonts(),
        hover: hover ? { x: hover.x, rowIndex: hover.rowIndex, session: hover.session } : null,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows, viewport, width, height, showStrip, now, hover, fontsVersion]);

  // ── Hit testing ────────────────────────────────────────────────────────
  const hitTest = useCallback(
    (clientX: number, clientY: number): Hover | null => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect || width === 0) return null;
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || x > width || y < 0 || y > height) return null;
      const time = xToTime(x, viewportRef.current, width);
      const rowIndex = y >= top ? Math.floor((y - top) / LAYOUT.rowHeight) : null;
      const row = rowIndex !== null ? rows[rowIndex] : undefined;
      // Hit target is wider than the bar: 6px either side.
      const tolerance = (6 / width) * span(viewportRef.current);
      const session = row ? sessionNear(row.sessions, time, tolerance) : null;
      return { x, y, rowIndex: row ? rowIndex : null, session, time };
    },
    [rows, width, height, top],
  );

  // ── Wheel: zoom (vertical) / pan (horizontal or Shift) ──────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const v = viewportRef.current;
      const b = boundsRef.current;
      const rect = canvas.getBoundingClientRect();
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        const delta = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        e.preventDefault();
        setViewport(panBy(v, (delta / rect.width) * span(v), b));
        return;
      }
      const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
      const atMaxOut = span(v) >= b.max - b.min - 1;
      // At full zoom-out, scrolling further "out" scrolls the page instead of trapping it.
      if (factor > 1 && atMaxOut && !e.ctrlKey) return;
      e.preventDefault();
      setViewport(zoomAt(v, factor, (e.clientX - rect.left) / rect.width, b));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [setViewport]);

  // ── Pointer: drag to pan, pinch to zoom, tap/click to select ───────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinchDist?: number; start: Viewport } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    const pts = [...pointers.current.values()];
    gesture.current = {
      startX: e.clientX,
      startY: e.clientY,
      moved: gesture.current?.moved ?? false,
      start: viewportRef.current,
      pinchDist: pts.length === 2 ? Math.abs(pts[0]!.x - pts[1]!.x) : undefined,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") setHover(hitTest(e.clientX, e.clientY));
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = e.currentTarget.getBoundingClientRect();
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.pinchDist) {
      const dist = Math.max(10, Math.abs(pts[0]!.x - pts[1]!.x));
      const mid = (pts[0]!.x + pts[1]!.x) / 2 - rect.left;
      g.moved = true;
      setViewport(zoomAt(g.start, g.pinchDist / dist, mid / rect.width, boundsRef.current));
      return;
    }
    const dx = e.clientX - g.startX;
    if (!g.moved && Math.abs(dx) < 4 && Math.abs(e.clientY - g.startY) < 4) return;
    if (!g.moved) setDragging(true);
    g.moved = true;
    setHover(null);
    setViewport(panBy(g.start, (-dx / rect.width) * span(g.start), boundsRef.current));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // Pinch → one finger left: restart the pan from here.
      const [p] = [...pointers.current.values()];
      gesture.current = { startX: p!.x, startY: p!.y, moved: true, start: viewportRef.current };
      return;
    }
    gesture.current = null;
    setDragging(false);
    if (g && !g.moved && onSelectPlayer) {
      const hit = hitTest(e.clientX, e.clientY);
      const row = hit?.rowIndex !== null && hit?.rowIndex !== undefined ? rows[hit.rowIndex] : undefined;
      if (row) onSelectPlayer(row.player, { x: e.clientX, y: e.clientY });
    }
  };

  // ── Keyboard ───────────────────────────────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewportRef.current;
    const b = boundsRef.current;
    const handled: Record<string, () => Viewport> = {
      ArrowLeft: () => panBy(v, -span(v) * 0.15, b),
      ArrowRight: () => panBy(v, span(v) * 0.15, b),
      "+": () => zoomAt(v, 0.7, 0.5, b),
      "=": () => zoomAt(v, 0.7, 0.5, b),
      "-": () => zoomAt(v, 1 / 0.7, 0.5, b),
      "0": () => ({ start: b.min, end: b.max }),
    };
    const action = handled[e.key];
    if (action) {
      e.preventDefault();
      setViewport(action());
    }
  };

  const hoveredRow = hover?.rowIndex !== null && hover?.rowIndex !== undefined ? rows[hover.rowIndex] : undefined;
  const readout = hover ? onlineAt(rows, hover.time) : [];
  const labelWidth = compactLabels ? "w-28 sm:w-36" : "w-32 sm:w-48";

  return (
    <div className="relative flex select-none">
      {/* Player labels (DOM, so they're real buttons for keyboard + screen readers). */}
      <div className={`${labelWidth} shrink-0 border-r border-line-soft`}>
        <div style={{ height: LAYOUT.axisHeight }} />
        {showStrip ? (
          <div className="flex items-center px-3 eyebrow" style={{ height: LAYOUT.stripHeight + LAYOUT.stripGap }}>
            Online
          </div>
        ) : null}
        {rows.map((row, i) => (
          <button
            key={row.player.id}
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onSelectPlayer?.(row.player, { x: r.right, y: r.top + r.height / 2 });
            }}
            className={`group flex w-full items-center gap-2 px-3 text-left text-sm transition-colors ${
              hover?.rowIndex === i ? "bg-white/[0.03]" : "hover:bg-white/[0.03]"
            }`}
            style={{ height: LAYOUT.rowHeight }}
            aria-label={`${row.player.name}${onlineIds?.has(row.player.id) ? ", online" : ""}: show player card`}
          >
            <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: row.player.color }} aria-hidden />
            <Avatar uuid={row.player.uuid} name={row.player.name} color={row.player.color} size={20} />
            <span className="truncate text-ink group-hover:text-white">{row.player.name}</span>
            {onlineIds?.has(row.player.id) ? (
              <span className="ml-auto">
                <OnlineBadge compact />
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Plot */}
      <div
        ref={wrapRef}
        className="relative min-w-0 flex-1 outline-none"
        tabIndex={0}
        role="group"
        aria-roledescription="interactive timeline"
        aria-label={`${ariaLabel}. Showing ${formatRange(viewport.start, viewport.end)}. Use arrow keys to pan, plus and minus to zoom, 0 to fit.`}
        onKeyDown={onKeyDown}
      >
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, touchAction: "pan-y", cursor: dragging ? "grabbing" : "crosshair" }}
          aria-hidden
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse" && !dragging) setHover(null);
          }}
        />
        {hover && !dragging && !suppressHover ? (
          <HoverReadout hover={hover} width={width} row={hoveredRow} online={readout} />
        ) : null}
      </div>
    </div>
  );
}

function HoverReadout({
  hover,
  width,
  row,
  online,
}: {
  hover: Hover;
  width: number;
  row: TimelineRow | undefined;
  online: PlayerRefDto[];
}) {
  const s = hover.session;
  const flip = hover.x > width - 260;
  let body: ReactNode;
  if (s && row) {
    body = (
      <>
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: row.player.color }} />
          <span className="text-xs text-ink-2">{row.player.name}</span>
        </div>
        <div className="mt-1 text-lg font-semibold leading-tight">{formatDuration(s.duration)}</div>
        <div className="text-xs text-ink-2">
          {formatRange(s.start, s.end)}
          {s.live ? " · online now" : ""}
        </div>
        {END_REASON_NOTE[s.endReason] && !s.live ? <div className="mt-1 text-[11px] text-ink-3">{END_REASON_NOTE[s.endReason]}</div> : null}
      </>
    );
  } else {
    body = (
      <>
        <div className="text-xs text-ink-2">{formatDateTime(hover.time)}</div>
        <div className="mt-0.5 text-sm font-semibold">
          {online.length} {online.length === 1 ? "player" : "players"} online
        </div>
        {online.length ? (
          <ul className="mt-1 space-y-0.5">
            {online.slice(0, 10).map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-xs text-ink-2">
                <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
                {p.name}
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-44 max-w-64 rounded-lg border border-line bg-raised/95 px-3 py-2 shadow-[var(--shadow-pop)] backdrop-blur"
      style={{ left: flip ? undefined : hover.x + 14, right: flip ? width - hover.x + 14 : undefined, top: Math.max(4, hover.y - 20) }}
    >
      {body}
    </div>
  );
}

/** Resolves next/font's generated family names for canvas text (canvas can't read CSS variables). */
function resolveFonts() {
  const css = getComputedStyle(document.documentElement);
  const sans = css.getPropertyValue("--font-geist-sans").trim();
  const mono = css.getPropertyValue("--font-geist-mono").trim();
  return { sans: sans ? `${sans}, sans-serif` : "sans-serif", mono: mono ? `${mono}, monospace` : "monospace" };
}

/** Bumps once webfonts have loaded so the canvas redraws its labels with them. */
function useFontsReady() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => !cancelled && setVersion((v) => v + 1));
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
