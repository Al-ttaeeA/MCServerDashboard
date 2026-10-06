import { concurrencySteps, visibleSessions, type Interval, type TimelineRow } from "@/lib/timeline/model";
import { dayBoundaries, generateTicks } from "@/lib/timeline/ticks";
import { span, timeToX, type Viewport } from "@/lib/timeline/viewport";

/**
 * Canvas renderer for the activity timeline.
 *
 * Only what's inside the viewport is drawn (binary-searched per row), so
 * cost scales with what's visible, not with history size. Glow is skipped
 * when very many bars are on screen to keep panning smooth.
 */

export const LAYOUT = {
  axisHeight: 30,
  stripHeight: 34,
  stripGap: 6,
  rowHeight: 38,
  barHeight: 14,
};

export function plotTop(showStrip: boolean): number {
  return LAYOUT.axisHeight + (showStrip ? LAYOUT.stripHeight + LAYOUT.stripGap : 0);
}

export function canvasHeight(rowCount: number, showStrip: boolean): number {
  return plotTop(showStrip) + rowCount * LAYOUT.rowHeight;
}

export interface RenderState {
  rows: TimelineRow[];
  viewport: Viewport;
  width: number;
  height: number;
  showStrip: boolean;
  now: number;
  hover: { x: number; rowIndex: number | null; session: Interval | null } | null;
  /** Resolved font families (canvas can't read CSS variables). */
  fonts: { sans: string; mono: string };
}

const C = {
  surface: "#0e1014",
  grid: "#171b23",
  gridMajor: "#232935",
  axisText: "#6c7380",
  axisTextMajor: "#a4abb8",
  night: "rgba(70, 95, 170, 0.045)",
  strip: "#a4abb8",
  crosshair: "rgba(233, 236, 241, 0.35)",
  now: "#7ee08a",
  hoverRow: "rgba(255, 255, 255, 0.022)",
};

export function render(ctx: CanvasRenderingContext2D, s: RenderState): void {
  const { width, height, viewport: v, rows } = s;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = C.surface;
  ctx.fillRect(0, 0, width, height);

  const top = plotTop(s.showStrip);
  const ticks = generateTicks(v.start, v.end, width);
  const x = (t: number) => timeToX(t, v, width);

  // Night bands (00:00–06:00 local) when zoomed in enough to read hours.
  if (span(v) <= 10 * 86_400_000) {
    ctx.fillStyle = C.night;
    for (const midnight of [startOfLocalDay(v.start), ...dayBoundaries(v.start, v.end)]) {
      const x0 = x(midnight);
      const x1 = x(midnight + 6 * 3_600_000);
      if (x1 > 0 && x0 < width) ctx.fillRect(x0, top, x1 - x0, height - top);
    }
  }

  // Gridlines + axis labels.
  ctx.font = `500 11px ${s.fonts.mono}`;
  ctx.textBaseline = "middle";
  for (const tick of ticks) {
    const tx = Math.round(x(tick.t)) + 0.5;
    ctx.strokeStyle = tick.major ? C.gridMajor : C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, LAYOUT.axisHeight - 6);
    ctx.lineTo(tx, height);
    ctx.stroke();
    // Skip labels that would be clipped at the right edge.
    if (tx + 5 + ctx.measureText(tick.label).width > width - 2) continue;
    ctx.fillStyle = tick.major ? C.axisTextMajor : C.axisText;
    ctx.fillText(tick.label, tx + 5, LAYOUT.axisHeight / 2);
  }

  // Concurrency strip: how many players were online (single series, neutral).
  if (s.showStrip) drawStrip(ctx, s, x);

  // Player rows.
  const visibleBars = rows.reduce((n, r) => n + visibleSessions(r.sessions, v.start, v.end).length, 0);
  const glow = visibleBars < 1500;
  rows.forEach((row, i) => {
    const y = top + i * LAYOUT.rowHeight;
    const cy = y + LAYOUT.rowHeight / 2;
    const color = row.player.color;
    const hovered = s.hover?.rowIndex === i;

    if (hovered) {
      ctx.fillStyle = C.hoverRow;
      ctx.fillRect(0, y, width, LAYOUT.rowHeight);
    }
    // Offline "rail": the row stays present but dim, with a faint glow of the player's colour.
    ctx.fillStyle = withAlpha(color, 0.035);
    ctx.fillRect(0, cy - LAYOUT.barHeight / 2 - 3, width, LAYOUT.barHeight + 6);
    ctx.fillStyle = withAlpha(color, 0.2);
    ctx.fillRect(0, cy - 1, width, 2);

    for (const sess of visibleSessions(row.sessions, v.start, v.end)) {
      drawSession(ctx, sess, x(sess.start), x(sess.end), cy, color, glow, s.hover?.session === sess);
    }
  });

  // "Now" marker.
  const nowX = x(s.now);
  if (nowX >= 0 && nowX <= width) {
    ctx.fillStyle = withAlpha(C.now, 0.55);
    ctx.fillRect(Math.round(nowX), LAYOUT.axisHeight - 4, 1, height);
    // Label sits on its own pill so it never collides with tick labels.
    ctx.font = `600 10px ${s.fonts.sans}`;
    const label = "NOW";
    const tw = ctx.measureText(label).width + 10;
    const lx = Math.min(width - tw - 2, Math.max(2, nowX - tw / 2));
    ctx.fillStyle = C.surface;
    ctx.fillRect(lx - 2, 2, tw + 4, LAYOUT.axisHeight - 8);
    ctx.fillStyle = withAlpha(C.now, 0.14);
    ctx.beginPath();
    ctx.roundRect(lx, 5, tw, LAYOUT.axisHeight - 14, 4);
    ctx.fill();
    ctx.fillStyle = C.now;
    ctx.fillText(label, lx + 5, LAYOUT.axisHeight / 2 - 2);
  }

  // Crosshair.
  if (s.hover) {
    const hx = Math.round(s.hover.x) + 0.5;
    ctx.strokeStyle = C.crosshair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, LAYOUT.axisHeight);
    ctx.lineTo(hx, height);
    ctx.stroke();
  }
}

function drawSession(
  ctx: CanvasRenderingContext2D,
  sess: Interval,
  x0: number,
  x1: number,
  cy: number,
  color: string,
  glow: boolean,
  hovered: boolean,
) {
  const h = LAYOUT.barHeight;
  const left = Math.max(x0, -8);
  const right = Math.max(x1, left + 1.5); // never thinner than 1.5px
  const w = right - left;
  const y = cy - h / 2;
  const r = Math.min(4, w / 2);

  let fill: string | CanvasGradient = color;
  if (sess.estimated && w > 12) {
    // Approximate end (crash / missed leave): fade out instead of a hard edge.
    const g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, color);
    g.addColorStop(Math.max(0, 1 - Math.min(28, w / 2) / w), color);
    g.addColorStop(1, withAlpha(color, 0.15));
    fill = g;
  }

  ctx.save();
  if (glow && w > 2) {
    ctx.shadowColor = withAlpha(color, hovered ? 0.85 : 0.55);
    ctx.shadowBlur = hovered ? 16 : 10;
  }
  ctx.fillStyle = fill;
  roundRect(ctx, left, y, w, h, r);
  ctx.fill();
  ctx.restore();

  // Lit top edge — reads as "on" rather than a flat block.
  if (w > 6) {
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(left + r, y + 1, Math.max(0, w - 2 * r), 1);
  }
  if (hovered) {
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    roundRect(ctx, left, y, w, h, r);
    ctx.fill();
  }
  if (sess.live && w > 4) {
    // Still online: bright cap at the leading edge.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(right - 2, y + 2, 2, h - 4);
  }
}

function drawStrip(ctx: CanvasRenderingContext2D, s: RenderState, x: (t: number) => number) {
  const { viewport: v, width } = s;
  const top = LAYOUT.axisHeight + 2;
  const h = LAYOUT.stripHeight - 4;
  const steps = concurrencySteps(s.rows, v.start, v.end);
  const max = Math.max(1, ...steps.map(([, c]) => c));
  const yFor = (c: number) => top + h - (c / max) * h;

  ctx.beginPath();
  ctx.moveTo(0, top + h);
  let prevY = yFor(0);
  for (const [t, c] of steps) {
    const sx = Math.min(width, Math.max(0, x(t)));
    ctx.lineTo(sx, prevY);
    prevY = yFor(c);
    ctx.lineTo(sx, prevY);
  }
  ctx.lineTo(width, prevY);
  ctx.lineTo(width, top + h);
  ctx.closePath();
  ctx.fillStyle = withAlpha(C.strip, 0.14);
  ctx.fill();

  ctx.beginPath();
  prevY = yFor(0);
  ctx.moveTo(0, prevY);
  for (const [t, c] of steps) {
    const sx = Math.min(width, Math.max(0, x(t)));
    ctx.lineTo(sx, prevY);
    prevY = yFor(c);
    ctx.lineTo(sx, prevY);
  }
  ctx.lineTo(width, prevY);
  ctx.strokeStyle = withAlpha(C.strip, 0.7);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, top + h + 0.5);
  ctx.lineTo(width, top + h + 0.5);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** `#rrggbb` + alpha → rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
