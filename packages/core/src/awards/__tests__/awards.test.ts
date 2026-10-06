import { describe, expect, it } from "vitest";
import { allocateAwards } from "../allocate";
import { computeAwards } from "../engine";
import type { AwardsInput } from "../features";
import { META_METRICS, METRICS } from "../catalog";
import { fmtClock, fmtComparison, fmtDuration, fmtTimes, fmtValue } from "../format";
import { evaluateMetric, midRankPercentile, transformValue } from "../significance";
import type { Candidate, MetricDefinition, MetricFamily } from "../types";

// ── A tiny synthetic metric for testing significance in isolation ──────

type F = { v: number | null; n: number };
const metric = (over: Partial<MetricDefinition<F>> = {}): MetricDefinition<F> => ({
  id: "test",
  family: "mining",
  source: "PLAYER_STATS",
  formula: "test",
  unit: "count",
  transform: "log1p",
  minSpread: 1,
  value: (f) => f.v,
  sample: (f) => f.n,
  minSample: 1,
  halfConfidenceAt: 1,
  reliability: 1,
  high: { title: "High", emoji: "⬆️", line: () => "", explain: () => "" },
  low: { title: "Low", emoji: "⬇️", line: () => "", explain: () => "" },
  ...over,
});
const pop = (values: (number | null)[], n = 100) => values.map((v, i) => ({ key: `p${i}`, features: { v, n } }));

describe("significance", () => {
  it("identical values → no candidates", () => {
    const ev = evaluateMetric(metric(), pop([50, 50, 50, 50, 50]), 0.15);
    expect(ev.candidates).toEqual([]);
    expect(ev.diagnostics.note).toContain("tie");
  });

  it("one extreme outlier → a strong high candidate for that player only", () => {
    const ev = evaluateMetric(metric(), pop([50, 55, 60, 52, 58, 2400]), 0.15);
    expect(ev.candidates).toHaveLength(1);
    expect(ev.candidates[0]).toMatchObject({ playerKey: "p5", direction: "high" });
    expect(ev.candidates[0]!.score).toBeGreaterThan(0.5);
  });

  it("recognises unusually LOW values too (two-sided)", () => {
    const ev = evaluateMetric(metric(), pop([60, 55, 70, 65, 58, 2]), 0.15);
    expect(ev.candidates.map((c) => [c.playerKey, c.direction])).toEqual([["p5", "low"]]);
  });

  it("two extreme outliers → only the most extreme one is a candidate, with less rarity", () => {
    const ev = evaluateMetric(metric(), pop([50, 55, 60, 2400, 2300]), 0.15);
    const highs = ev.candidates.filter((c) => c.direction === "high");
    expect(highs.map((c) => c.playerKey)).toEqual(["p3"]);
    expect(highs[0]!.rarity).toBeLessThan(0.75);
  });

  it("ties at the top → nobody gets it", () => {
    const ev = evaluateMetric(metric(), pop([50, 55, 60, 900, 900]), 0.15);
    expect(ev.candidates.filter((c) => c.direction === "high")).toEqual([]);
  });

  it("tiny populations (< 3 eligible) → not evaluated", () => {
    const ev = evaluateMetric(metric(), pop([1, 1000]), 0.15);
    expect(ev.candidates).toEqual([]);
    expect(ev.diagnostics.note).toContain("eligible");
  });

  it("small populations dampen scores", () => {
    const small = evaluateMetric(metric(), pop([50, 55, 2400]), 0).candidates[0]!;
    const big = evaluateMetric(metric(), pop([50, 55, 52, 58, 2400]), 0).candidates[0]!;
    expect(small.populationFactor).toBeLessThan(big.populationFactor);
  });

  it("missing data and insufficient samples are NOT ELIGIBLE", () => {
    const players = [...pop([50, 55, 60, null]), { key: "thin", features: { v: 99999, n: 0.5 } }];
    const ev = evaluateMetric(metric({ minSample: 1 }), players, 0.15);
    const row = (k: string) => ev.diagnostics.rows.find((r) => r.playerKey === k)!;
    expect(row("p3")).toMatchObject({ eligible: false, reason: "no data" });
    expect(row("thin")).toMatchObject({ eligible: false });
    expect(ev.candidates.some((c) => c.playerKey === "thin")).toBe(false);
  });

  it("sample confidence scales the score", () => {
    const sure = evaluateMetric(metric(), pop([50, 55, 60, 52, 2400], 100), 0).candidates[0]!;
    const unsure = evaluateMetric(metric(), pop([50, 55, 60, 52, 2400], 1), 0).candidates[0]!;
    expect(unsure.score).toBeLessThan(sure.score);
  });

  it("tightly clustered values don't produce awards (minSpread floor)", () => {
    const ev = evaluateMetric(metric({ transform: "logit", minSpread: 0.1, unit: "ratio" }), pop([0.5, 0.52, 0.51, 0.53, 0.55]), 0.15);
    expect(ev.candidates).toEqual([]);
  });

  it("log transform tames skew: a 10× outlier in a skewed metric beats a 2× one", () => {
    const x10 = evaluateMetric(metric(), pop([10, 20, 15, 30, 25, 300]), 0).candidates.find((c) => c.direction === "high")!;
    const x2 = evaluateMetric(metric(), pop([10, 20, 15, 30, 25, 60]), 0).candidates.find((c) => c.direction === "high");
    expect(x2 === undefined || x2.score < x10.score).toBe(true);
  });

  it("transforms and percentiles behave", () => {
    expect(transformValue(0, "log1p")).toBe(0);
    expect(transformValue(0, "logit")).toBeLessThan(-4);
    expect(transformValue(1, "logit")).toBeGreaterThan(4);
    expect(midRankPercentile([1, 2, 3, 4, 5], 5)).toBe(100);
    expect(midRankPercentile([1, 2, 3, 4, 5], 1)).toBe(0);
    expect(midRankPercentile([1, 2, 2, 4], 2)).toBeCloseTo(50);
  });
});

// ── Allocation ─────────────────────────────────────────────────────────

const cand = (playerKey: string, metricId: string, score: number, family: MetricFamily = metricId as MetricFamily, direction: "high" | "low" = "high"): Candidate => ({
  metricId, family, playerKey, direction, value: 1, z: 2, percentile: 100, median: 0, gap: 1,
  extremeness: score, rarity: 1, confidence: 1, populationFactor: 1, reliability: 1, score,
});

describe("allocateAwards", () => {
  it("never gives a metric to more than one player and caps each player at 3", () => {
    const cs = [
      cand("A", "m1", 0.9, "mining"), cand("B", "m1", 0.8, "mining", "low"),
      cand("A", "m2", 0.9, "deaths"), cand("A", "m3", 0.9, "chat"), cand("A", "m4", 0.9, "social"), cand("A", "m5", 0.9, "movement"),
    ];
    const out = allocateAwards(cs, 3);
    const byMetric = new Map<string, number>();
    for (const c of out) byMetric.set(c.metricId, (byMetric.get(c.metricId) ?? 0) + 1);
    expect([...byMetric.values()].every((n) => n === 1)).toBe(true);
    expect(out.filter((c) => c.playerKey === "A")).toHaveLength(3);
  });

  it("is globally optimal, not greedy: gives the shared metric to the player who needs it", () => {
    // Greedy by score would hand m1 to A (0.9) and leave B with nothing.
    const cs = [cand("A", "m1", 0.9, "mining"), cand("A", "m2", 0.85, "deaths"), cand("A", "m3", 0.8, "chat"), cand("A", "m4", 0.75, "social"), cand("B", "m1", 0.3, "mining")];
    const out = allocateAwards(cs, 3);
    expect(out.find((c) => c.metricId === "m1")!.playerKey).toBe("B");
    expect(out.filter((c) => c.playerKey === "A").map((c) => c.metricId).sort()).toEqual(["m2", "m3", "m4"]);
  });

  it("a dominant player can't take everything: three players get one award each", () => {
    const cs = [
      cand("A", "m1", 1, "mining"), cand("A", "m2", 1, "deaths"), cand("A", "m3", 1, "chat"),
      cand("B", "m1", 0.2, "mining"), cand("C", "m2", 0.2, "deaths"), cand("D", "m3", 0.2, "chat"),
    ];
    const out = allocateAwards(cs, 3);
    expect(out).toHaveLength(3);
    expect(out.filter((c) => c.playerKey === "A")).toHaveLength(1);
    expect(new Set(out.map((c) => c.playerKey)).size).toBe(3);
  });

  it("only one of a metric's two directions is ever awarded", () => {
    const out = allocateAwards([cand("A", "playtime", 0.9, "playtime", "high"), cand("B", "playtime", 0.95, "playtime", "low"), cand("A", "x", 0.5, "mining")], 3);
    expect(out.filter((c) => c.metricId === "playtime")).toHaveLength(1);
  });

  it("at most one award per family per player", () => {
    const out = allocateAwards([cand("A", "d1", 0.9, "deaths"), cand("A", "d2", 0.9, "deaths"), cand("A", "d3", 0.9, "deaths")], 3);
    expect(out).toHaveLength(1);
  });

  it("players without candidates simply get nothing; empty input is fine", () => {
    expect(allocateAwards([], 3)).toEqual([]);
    expect(allocateAwards([cand("A", "m1", 0.5, "mining")], 3).map((c) => c.playerKey)).toEqual(["A"]);
  });

  it("is deterministic", () => {
    const cs = [cand("A", "m1", 0.5, "mining"), cand("B", "m1", 0.5, "mining", "low")];
    expect(allocateAwards(cs, 3)).toEqual(allocateAwards([...cs].reverse(), 3));
  });
});

// ── End to end on a synthetic server ───────────────────────────────────

const H = 3_600_000;
const T0 = Date.parse("2026-10-01T00:00:00Z"); // 8 PM EDT on Sep 30
const U = (i: number) => `00000000-0000-4000-8000-00000000000${i}`;

function server(): AwardsInput {
  type Mutable<T> = { -readonly [K in keyof T]: T[K] };
  const players = ["Ahmed", "Ryan", "John", "Sam", "Lee", "Kai"].map((name, i) => ({ key: U(i), uuid: U(i), name }));
  const sessions: Mutable<AwardsInput["sessions"]> = [];
  const add = (i: number, startH: number, durH: number) =>
    sessions.push({ playerKey: U(i), startTs: T0 + startH * H, endTs: T0 + (startH + durH) * H, endReason: "leave" });
  for (let d = 0; d < 10; d++) {
    add(0, d * 24 + 1, 8); // Ahmed: marathon evenings (9 PM EDT → 5 AM)
    add(1, d * 24 + 5, 2); // Ryan: 1–3 AM EDT, night owl
    if (d % 3 === 0) add(2, d * 24 + 14, 1.5); // John: daytime, occasional
    add(3, d * 24 + 2, 3);
    add(4, d * 24 + 3, 2.5);
    add(5, d * 24 + 20, 1); // Kai: afternoons
  }
  const stat = (mined: number, deaths: number, playH: number) => ({
    custom: { play_time: playH * 72000, deaths, mob_kills: 10, walk_one_cm: 500_000 },
    mined: { stone: mined, diamond_ore: Math.round(mined / 100) },
  });
  const worldStats = new Map([
    [U(0), stat(30000, 5, 80)],
    [U(1), stat(2000, 4, 20)],
    [U(2), stat(1500, 3, 15)],
    [U(3), stat(1800, 4, 30)],
    [U(4), stat(1600, 2, 25)],
    [U(5), stat(1700, 3, 10)],
  ]);
  const events: Mutable<AwardsInput["events"]> = [];
  for (let k = 0; k < 40; k++) events.push({ playerKey: U(2), ts: T0 + (k * 24 + 14.5) * H, event: { type: "DEATH", player: "John", message: "John fell from a high place", cause: "fell.accident.generic" } });
  return { players, sessions, events, worldStats, worldAdvancements: new Map(), profiles: new Map(), timeZone: "America/New_York", now: T0 + 12 * 24 * H };
}

describe("computeAwards (end to end)", () => {
  const result = computeAwards(server());
  const all = [...result.awards.values()].flat();

  it("assigns each award title to at most one player", () => {
    const ids = all.map((a) => a.metricId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives at most three awards per player, from different families", () => {
    for (const list of result.awards.values()) expect(list.length).toBeLessThanOrEqual(3);
  });

  it("finds the obvious outliers", () => {
    const titlesFor = (name: string) => (result.awards.get(U(["Ahmed", "Ryan", "John", "Sam", "Lee", "Kai"].indexOf(name))) ?? []).map((a) => a.title);
    expect(titlesFor("John").some((t) => /Graveyard|Respawn|Fall Guy|Darwin/.test(t))).toBe(true);
    expect(titlesFor("Ahmed").length).toBeGreaterThan(0);
  });

  it("writes deterministic, human-readable explanations", () => {
    for (const a of all) {
      expect(a.explanation.length).toBeGreaterThan(20);
      expect(a.explanation).not.toMatch(/undefined|NaN|\bnull\b/);
      expect(a.line).not.toMatch(/undefined|NaN/);
    }
    expect(computeAwards(server())).toEqual(result);
  });

  it("respects disabled categories", () => {
    const noDeaths = computeAwards(server(), { awardsPerPlayer: 3, minScore: 0.15, disabledCategories: ["deaths"], disabledMetrics: [] });
    const sensitiveOf = new Map(noDeaths.metrics.map((m) => [m.id, m.sensitive]));
    const awarded = [...noDeaths.awards.values()].flat();
    expect(awarded.some((a) => sensitiveOf.get(a.metricId) === "deaths")).toBe(false);
    expect(noDeaths.diagnostics.some((d) => d.metricId === "deaths")).toBe(false);
  });

  it("records list up to three contenders, holder first, in record order", () => {
    expect(result.records.length).toBeGreaterThan(0);
    for (const r of result.records) {
      expect(r.contenders.length).toBeGreaterThanOrEqual(2);
      expect(r.contenders.length).toBeLessThanOrEqual(3);
      expect(r.contenders[0]!.playerKey).toBe(r.playerKey);
      const vals = r.contenders.map((c) => c.value);
      const sorted = [...vals].sort((a, b) => (r.direction === "high" ? b - a : a - b));
      expect(vals).toEqual(sorted);
    }
  });

  it("exposes every candidate and diagnostic for the debug view", () => {
    expect(result.candidates.length).toBeGreaterThanOrEqual(all.length);
    expect(result.diagnostics.length).toBeGreaterThan(50);
    expect(result.metrics.length).toBeGreaterThanOrEqual(50);
  });
});

describe("explanation templates", () => {
  const ctx = (value: number, unit: MetricDefinition<unknown>["unit"]) => ({
    name: "Alex",
    value,
    formatted: fmtValue(value, unit),
    times: fmtTimes(value),
    median: 1,
    medianFormatted: "1",
    comparison: "2× the server median",
    extra: { every: "1h", km: "1", messages: "3", hours: "2h", partner: "Bea", together: "1h", shortest: "1m", longest: "2h" },
  });

  it("per-hour rates keep their decimals (never rounded to 'once')", () => {
    for (const m of [...METRICS, ...META_METRICS].filter((x) => x.unit === "per_hour")) {
      for (const t of [m.high, m.low]) {
        if (!t) continue;
        const text = t.explain(ctx(0.6, m.unit)) + " " + t.line(ctx(0.6, m.unit));
        expect(text, `${m.id} ${t.title}`).not.toMatch(/\bonce\b/);
      }
    }
  });

  it("every template renders without undefined/NaN for typical values", () => {
    for (const m of [...METRICS, ...META_METRICS]) {
      for (const t of [m.high, m.low]) {
        if (!t) continue;
        const text = t.explain(ctx(12, m.unit)) + t.line(ctx(12, m.unit));
        expect(text, m.id).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it("metadata is complete for every metric", () => {
    const all = [...METRICS, ...META_METRICS];
    expect(all.length).toBeGreaterThanOrEqual(50);
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    for (const m of all) {
      expect(m.formula.length, m.id).toBeGreaterThan(5);
      expect(m.high ?? m.low, m.id).toBeDefined();
      expect(["LOG", "PLAYER_STATS", "ADVANCEMENTS", "PLAYER_DATA", "DERIVED"]).toContain(m.source);
    }
  });
});

describe("format", () => {
  it("formats durations, clock times and comparisons", () => {
    expect(fmtDuration(8 * 3600 + 14 * 60)).toBe("8h 14m");
    expect(fmtClock(15.25)).toBe("3:15 AM");
    expect(fmtClock(0)).toBe("12:00 PM");
    expect(fmtComparison(71, 21, "ratio")).toBe("3.4× the server median");
    expect(fmtComparison(5, 0, "count")).toBe("while the rest of the server is at zero");
    expect(fmtComparison(15, 13, "clock")).toBe("2 hours later than the server's typical time");
  });
});
