import { describe, expect, it } from "vitest";
import type { PlayerRefDto, SessionDto } from "@smp/core";
import { buildRows, concurrencySteps, onlineAt, sessionNear, totalInRange, visibleSessions } from "../timeline/model";
import { dayBoundaries, generateTicks, pickStep } from "../timeline/ticks";
import { MIN_SPAN_MS, boundsFor, clampViewport, panBy, span, wheelZoomFactor, zoomAt } from "../timeline/viewport";
import { placePopover } from "../popover";
import { formatDuration, formatStatValue } from "../format";

const H = 3_600_000;
const T0 = Date.parse("2026-10-05T12:00:00Z");

describe("viewport", () => {
  const bounds = { min: T0, max: T0 + 100 * H };

  it("zooms around the anchor, keeping the anchored time fixed", () => {
    const v = { start: T0 + 10 * H, end: T0 + 20 * H };
    const z = zoomAt(v, 0.5, 0.25, bounds);
    expect(span(z)).toBe(5 * H);
    const anchorBefore = v.start + 0.25 * span(v);
    const anchorAfter = z.start + 0.25 * span(z);
    expect(anchorAfter).toBeCloseTo(anchorBefore);
  });

  it("never zooms closer than the minimum span or past the data bounds", () => {
    const v = { start: T0 + 10 * H, end: T0 + 11 * H };
    expect(span(zoomAt(v, 0.0001, 0.5, bounds))).toBe(MIN_SPAN_MS);
    expect(zoomAt(v, 1000, 0.5, bounds)).toEqual({ start: bounds.min, end: bounds.max });
  });

  it("pans but stays within bounds", () => {
    const v = { start: T0 + 10 * H, end: T0 + 20 * H };
    expect(panBy(v, 5 * H, bounds)).toEqual({ start: T0 + 15 * H, end: T0 + 25 * H });
    expect(panBy(v, -50 * H, bounds)).toEqual({ start: T0, end: T0 + 10 * H });
    expect(clampViewport({ start: T0 + 95 * H, end: T0 + 105 * H }, bounds)).toEqual({ start: T0 + 90 * H, end: T0 + 100 * H });
  });

  it("maps wheel deltas to gentle zoom factors", () => {
    expect(wheelZoomFactor(-100, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(1 / wheelZoomFactor(-100, 0));
    expect(wheelZoomFactor(10_000, 0)).toBeCloseTo(Math.E); // clamped
  });

  it("pads bounds around the data", () => {
    const b = boundsFor(T0, T0 + 10 * H);
    expect(b.min).toBeLessThan(T0);
    expect(b.max).toBeGreaterThan(T0 + 10 * H);
  });
});

describe("ticks", () => {
  it("picks finer steps as you zoom in", () => {
    expect(pickStep(365 * 24 * H, 1200).unit).toBe("month");
    expect(pickStep(30 * 24 * H, 1200).unit).toBe("day");
    expect(pickStep(12 * H, 1200).unit).toBe("hour");
    expect(pickStep(30 * 60_000, 1200).unit).toBe("minute");
  });

  it("puts ticks on local round boundaries and marks midnights as major", () => {
    // 2026-10-05 20:00 EDT → 2026-10-06 04:00 EDT
    const start = Date.parse("2026-10-06T00:00:00Z");
    const ticks = generateTicks(start, start + 8 * H, 1200);
    expect(ticks.every((t) => new Date(t.t).getMinutes() === 0)).toBe(true);
    const midnight = ticks.find((t) => t.major)!;
    expect(new Date(midnight.t).getHours()).toBe(0);
    expect(midnight.label).toMatch(/Tue/);
  });

  it("lists day boundaries only when zoomed in enough", () => {
    expect(dayBoundaries(T0, T0 + 3 * 24 * H)).toHaveLength(3);
    expect(dayBoundaries(T0, T0 + 400 * 24 * H)).toEqual([]);
  });
});

describe("timeline model", () => {
  const alex: PlayerRefDto = { id: "a", name: "Alex", uuid: null, color: "#3987e5" };
  const bea: PlayerRefDto = { id: "b", name: "Bea", uuid: null, color: "#d95926" };
  const sess = (playerId: string, startH: number, endH: number, endReason: SessionDto["endReason"] = "leave"): SessionDto => ({
    playerId,
    start: new Date(T0 + startH * H).toISOString(),
    end: new Date(T0 + endH * H).toISOString(),
    duration: (endH - startH) * 3600,
    endReason,
    estimated: endReason === "open" || endReason === "crash",
  });
  const sessions = [sess("a", 0, 2), sess("a", 5, 6, "crash"), sess("b", 1, 3), sess("a", 8, 9, "open")];

  it("groups and sorts sessions per player, extending live sessions to now", () => {
    const rows = buildRows([alex, bea], sessions, T0 + 10 * H);
    expect(rows.map((r) => r.sessions.length)).toEqual([3, 1]);
    const live = rows[0]!.sessions[2]!;
    expect(live).toMatchObject({ live: true, estimated: false, end: T0 + 10 * H });
    expect(rows[0]!.sessions[1]!.estimated).toBe(true);
    // Without a recent sync, open sessions end at the last observed line.
    expect(buildRows([alex], sessions, null)[0]!.sessions[2]!.end).toBe(T0 + 9 * H);
  });

  it("finds visible sessions and hit-tests with tolerance", () => {
    const [row] = buildRows([alex], sessions, null);
    expect(visibleSessions(row!.sessions, T0 + 1.5 * H, T0 + 5.5 * H)).toHaveLength(2);
    expect(sessionNear(row!.sessions, T0 + 1 * H, 0)?.start).toBe(T0);
    expect(sessionNear(row!.sessions, T0 + 2.1 * H, 0)).toBeNull();
    expect(sessionNear(row!.sessions, T0 + 2.1 * H, 0.2 * H)?.start).toBe(T0);
  });

  it("computes who's online and concurrency", () => {
    const rows = buildRows([alex, bea], sessions, null);
    expect(onlineAt(rows, T0 + 1.5 * H).map((p) => p.name)).toEqual(["Alex", "Bea"]);
    const steps = concurrencySteps(rows, T0, T0 + 4 * H);
    expect(Math.max(...steps.map(([, c]) => c))).toBe(2);
    expect(steps.at(-1)![1]).toBe(0);
    expect(totalInRange(rows[0]!.sessions, T0 + 1 * H, T0 + 5.5 * H)).toBe(1.5 * 3600);
  });
});

describe("placePopover", () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 280, height: 300 };
  it("prefers below-right of the pointer", () => {
    expect(placePopover({ x: 100, y: 100 }, size, vp)).toEqual({ left: 112, top: 112 });
  });
  it("flips near the right/bottom edges and stays on screen", () => {
    const p = placePopover({ x: 950, y: 750 }, size, vp);
    expect(p.left + size.width).toBeLessThanOrEqual(vp.width - 12);
    expect(p.top + size.height).toBeLessThanOrEqual(vp.height - 12);
  });
  it("clamps on tiny screens", () => {
    expect(placePopover({ x: 10, y: 10 }, size, { width: 300, height: 320 })).toEqual({ left: 12, top: 12 });
  });
});

describe("format", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(30)).toBe("<1m");
    expect(formatDuration(42 * 60)).toBe("42m");
    expect(formatDuration(127 * 3600 + 42 * 60)).toBe("127h 42m");
    expect(formatDuration(3 * 3600)).toBe("3h");
  });
  it("formats stat values by unit", () => {
    expect(formatStatValue(0.4, "ratio")).toBe("40%");
    expect(formatStatValue(1, "days")).toBe("1 day");
    expect(formatStatValue(1.234, "rate")).toBe("1.23");
  });
});
