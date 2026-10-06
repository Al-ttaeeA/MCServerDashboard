/**
 * Timeline viewport math (pure, unit-tested).
 *
 * The viewport is just the visible time window [start, end) in ms. Zooming
 * scales the span around an anchor (the cursor), keeping the time under the
 * cursor fixed — the same feel as zooming a map. Only the horizontal (time)
 * scale ever changes; row heights are fixed.
 */
export interface Viewport {
  start: number;
  end: number;
}

export interface Bounds {
  min: number;
  max: number;
}

/** Closest zoom: 10 minutes across the whole width. */
export const MIN_SPAN_MS = 10 * 60_000;

export const span = (v: Viewport) => v.end - v.start;

export function clampViewport(v: Viewport, bounds: Bounds): Viewport {
  const maxSpan = Math.max(MIN_SPAN_MS, bounds.max - bounds.min);
  const s = Math.min(Math.max(span(v), MIN_SPAN_MS), maxSpan);
  let start = v.start;
  if (start < bounds.min) start = bounds.min;
  if (start + s > bounds.max) start = Math.max(bounds.min, bounds.max - s);
  return { start, end: start + s };
}

/**
 * @param factor  <1 zooms in, >1 zooms out
 * @param anchor  position of the zoom anchor within the viewport, 0 (left) … 1 (right)
 */
export function zoomAt(v: Viewport, factor: number, anchor: number, bounds: Bounds): Viewport {
  const a = Math.min(1, Math.max(0, anchor));
  const t = v.start + a * span(v);
  const maxSpan = Math.max(MIN_SPAN_MS, bounds.max - bounds.min);
  const next = Math.min(Math.max(span(v) * factor, MIN_SPAN_MS), maxSpan);
  return clampViewport({ start: t - a * next, end: t - a * next + next }, bounds);
}

export function panBy(v: Viewport, deltaMs: number, bounds: Bounds): Viewport {
  return clampViewport({ start: v.start + deltaMs, end: v.end + deltaMs }, bounds);
}

/** Wheel delta → zoom factor. Smooth for trackpads (small deltas), stepped for mouse wheels. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(Math.max(-1, Math.min(1, pixels * 0.0025)));
}

export const timeToX = (t: number, v: Viewport, width: number) => ((t - v.start) / span(v)) * width;
export const xToTime = (x: number, v: Viewport, width: number) => v.start + (x / width) * span(v);

/** Padded bounds around the data so you can scroll slightly past the ends. */
export function boundsFor(extentStart: number, extentEnd: number): Bounds {
  const pad = Math.max((extentEnd - extentStart) * 0.04, 30 * 60_000);
  return { min: extentStart - pad, max: extentEnd + pad };
}
