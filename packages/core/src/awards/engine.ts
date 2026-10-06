import { allocateAwards } from "./allocate";
import { GRIND_COMPONENTS, META_METRICS, METRICS, type MetaFeatures } from "./catalog";
import { AWARDS_CONFIG } from "./config";
import { computeFeatures, type AwardsInput, type PlayerFeatures } from "./features";
import { fmtComparison, fmtValue } from "./format";
import { evaluateMetric } from "./significance";
import type { Award, AwardsConfig, Candidate, MetricDefinition, MetricDiagnostics, MetricFamily, MetricSource, MetricUnit } from "./types";

/** Static description of a metric (for docs, leaderboards and debug). */
export interface MetricInfo {
  id: string;
  family: MetricFamily;
  source: MetricSource;
  formula: string;
  unit: MetricUnit;
  high?: { title: string; emoji: string };
  low?: { title: string; emoji: string };
  sensitive?: string;
}

export interface AwardsResult {
  /** Up to `awardsPerPlayer` awards per player key, most significant first. */
  awards: Map<string, Award[]>;
  /** Every candidate considered (winners and losers), for the debug view. */
  candidates: Candidate[];
  /** Per-metric eligibility and values, for the debug view and records. */
  diagnostics: MetricDiagnostics[];
  metrics: MetricInfo[];
}

type AnyMetric = MetricDefinition<PlayerFeatures> | MetricDefinition<MetaFeatures & PlayerFeatures>;

export function enabledMetrics<T extends AnyMetric>(list: readonly T[], config: AwardsConfig): T[] {
  return list.filter((m) => !config.disabledMetrics.includes(m.id) && !(m.sensitive && config.disabledCategories.includes(m.sensitive)));
}

export function computeAwards(input: AwardsInput, config: AwardsConfig = AWARDS_CONFIG): AwardsResult {
  const features = computeFeatures(input);
  // Only people who actually played compete.
  const players = [...features.values()].filter((f) => f.sessionCount > 0).map((f) => ({ key: f.key, features: f }));

  const candidates: Candidate[] = [];
  const diagnostics: MetricDiagnostics[] = [];
  const zByMetric = new Map<string, Map<string, number>>();

  for (const def of enabledMetrics(METRICS, config)) {
    const ev = evaluateMetric(def, players, config.minScore);
    candidates.push(...ev.candidates);
    diagnostics.push(ev.diagnostics);
    zByMetric.set(def.id, ev.z);
  }

  // Meta metrics are built from the base metrics' z-scores.
  const metaPlayers = players.map(({ key, features: f }) => ({ key, features: { ...f, ...metaFeatures(key, zByMetric) } }));
  for (const def of enabledMetrics(META_METRICS, config)) {
    const ev = evaluateMetric(def, metaPlayers, config.minScore);
    candidates.push(...ev.candidates);
    diagnostics.push(ev.diagnostics);
  }

  const winners = allocateAwards(candidates, config.awardsPerPlayer);
  const defs = new Map<string, AnyMetric>([...METRICS, ...META_METRICS].map((m) => [m.id, m]));
  const awards = new Map<string, Award[]>();
  for (const c of winners.sort((a, b) => b.score - a.score)) {
    const def = defs.get(c.metricId)!;
    const f = features.get(c.playerKey)!;
    const list = awards.get(c.playerKey) ?? [];
    list.push(toAward(c, def, f));
    awards.set(c.playerKey, list);
  }

  return {
    awards,
    candidates: candidates.sort((a, b) => b.score - a.score),
    diagnostics,
    metrics: [...METRICS, ...META_METRICS].map((m) => ({
      id: m.id,
      family: m.family,
      source: m.source,
      formula: m.formula,
      unit: m.unit,
      ...(m.high ? { high: { title: m.high.title, emoji: m.high.emoji } } : {}),
      ...(m.low ? { low: { title: m.low.title, emoji: m.low.emoji } } : {}),
      ...(m.sensitive ? { sensitive: m.sensitive } : {}),
    })),
  };
}

function metaFeatures(key: string, zByMetric: Map<string, Map<string, number>>): MetaFeatures {
  const defs = new Map(METRICS.map((m) => [m.id, m]));
  // Statistical Freak: how extreme is this player in the directions each metric cares about?
  const extremes: number[] = [];
  for (const [id, zs] of zByMetric) {
    const z = zs.get(key);
    const def = defs.get(id);
    if (z === undefined || !def) continue;
    const directional = Math.max(def.high ? z : -Infinity, def.low ? -z : -Infinity, 0);
    extremes.push(directional);
  }
  extremes.sort((a, b) => b - a);
  const statFreak = extremes.length >= 8 ? extremes.slice(0, 5).reduce((a, b) => a + b, 0) / 5 : null;

  const grindZ = GRIND_COMPONENTS.map((id) => zByMetric.get(id)?.get(key)).filter((z): z is number => z !== undefined);
  const grind = grindZ.length >= 3 ? grindZ.reduce((a, b) => a + b, 0) / grindZ.length : null;
  return { statFreak, grind };
}

function toAward(c: Candidate, def: AnyMetric, f: PlayerFeatures): Award {
  const title = c.direction === "high" ? def.high! : def.low!;
  const formatted = fmtValue(c.value, def.unit);
  const extra = (def.extra as ((x: PlayerFeatures) => Record<string, string | number>) | undefined)?.(f) ?? {};
  const ctx = {
    name: f.name,
    value: c.value,
    formatted,
    median: c.median,
    medianFormatted: fmtValue(c.median, def.unit),
    comparison: fmtComparison(c.value, c.median, def.unit),
    extra,
  };
  return {
    metricId: c.metricId,
    title: title.title,
    emoji: title.emoji,
    direction: c.direction,
    value: c.value,
    formatted,
    line: title.line(ctx),
    explanation: title.explain(ctx),
    percentile: Math.round(c.percentile),
    median: c.median,
    ratioToMedian: c.median > 0 && def.unit !== "clock" ? Math.round((c.value / c.median) * 10) / 10 : null,
    score: Math.round(c.score * 1000) / 1000,
  };
}
