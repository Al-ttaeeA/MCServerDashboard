import type { PlayerRefDto, SessionDto, SessionEndReason } from "@smp/core";

/**
 * Render-ready timeline data: one row per player, sessions as sorted numeric
 * intervals. Lookups (what's visible, what's under the cursor, who's online
 * at time t) are binary searches, so the canvas stays fast with tens of
 * thousands of sessions.
 */

export interface Interval {
  start: number;
  end: number;
  /** End time is an estimate (crash / missed leave). */
  estimated: boolean;
  /** Player is still online; `end` has been extended to "now". */
  live: boolean;
  endReason: SessionEndReason;
  duration: number;
}

export interface TimelineRow {
  player: PlayerRefDto;
  sessions: Interval[];
}

/**
 * @param liveUntil  if set, sessions that are still open are drawn up to
 *                   this time (usually "now") instead of the last log line.
 */
export function buildRows(players: PlayerRefDto[], sessions: SessionDto[], liveUntil: number | null): TimelineRow[] {
  const byPlayer = new Map<string, Interval[]>(players.map((p) => [p.id, []]));
  for (const s of sessions) {
    const list = byPlayer.get(s.playerId);
    if (!list) continue;
    const start = Date.parse(s.start);
    let end = Date.parse(s.end);
    const live = s.endReason === "open" && liveUntil !== null;
    if (live) end = Math.max(end, liveUntil);
    list.push({ start, end, estimated: s.estimated && !live, live, endReason: s.endReason, duration: (end - start) / 1000 });
  }
  return players.map((player) => ({
    player,
    sessions: (byPlayer.get(player.id) ?? []).sort((a, b) => a.start - b.start),
  }));
}

/** Index of the first session whose end is after `t` (sessions don't overlap within a row). */
export function firstEndingAfter(sessions: readonly Interval[], t: number): number {
  let lo = 0;
  let hi = sessions.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sessions[mid]!.end <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sessions intersecting [start, end). */
export function visibleSessions(sessions: readonly Interval[], start: number, end: number): Interval[] {
  const out: Interval[] = [];
  for (let i = firstEndingAfter(sessions, start); i < sessions.length && sessions[i]!.start < end; i++) out.push(sessions[i]!);
  return out;
}

/** Session at time t, or the nearest one within `toleranceMs` (generous hit target for thin bars). */
export function sessionNear(sessions: readonly Interval[], t: number, toleranceMs: number): Interval | null {
  const i = firstEndingAfter(sessions, t - toleranceMs);
  let best: Interval | null = null;
  let bestDist = Infinity;
  for (let j = Math.max(0, i - 1); j < Math.min(sessions.length, i + 2); j++) {
    const s = sessions[j]!;
    const dist = t < s.start ? s.start - t : t > s.end ? t - s.end : 0;
    if (dist <= toleranceMs && dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

export function onlineAt(rows: readonly TimelineRow[], t: number): PlayerRefDto[] {
  return rows.filter((r) => sessionNear(r.sessions, t, 0) !== null).map((r) => r.player);
}

/**
 * Online-player count as a step function over [start, end], for the
 * concurrency strip. Returns change points [time, count].
 */
export function concurrencySteps(rows: readonly TimelineRow[], start: number, end: number): [number, number][] {
  const deltas: [number, number][] = [];
  for (const r of rows) {
    for (const s of visibleSessions(r.sessions, start, end)) {
      deltas.push([Math.max(s.start, start), 1], [Math.min(s.end, end), -1]);
    }
  }
  deltas.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const steps: [number, number][] = [[start, 0]];
  let count = 0;
  for (const [t, d] of deltas) {
    count += d;
    const last = steps[steps.length - 1]!;
    if (last[0] === t) last[1] = count;
    else steps.push([t, count]);
  }
  steps.push([end, count]);
  return steps;
}

export function totalInRange(sessions: readonly Interval[], start: number, end: number): number {
  let ms = 0;
  for (const s of visibleSessions(sessions, start, end)) ms += Math.min(s.end, end) - Math.max(s.start, start);
  return ms / 1000;
}
