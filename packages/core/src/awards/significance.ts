import type { Candidate, Direction, MetricDefinition, MetricDiagnostics, MetricTransform } from "./types";

/**
 * Significance: how remarkable is one player's value for one metric,
 * relative to the rest of the server?
 *
 *   score = extremeness × rarity × confidence × populationFactor × reliability
 *
 * 1. Transform the values (log1p for skewed counts, logit for shares).
 * 2. Leave-one-out robust z: compare the player with EVERYONE ELSE —
 *      z = (t_i − median_others) / spread_others
 *    where spread = max(1.4826·MAD, IQR/1.349, floor). MAD/IQR are robust
 *    to skew; leaving the player out stops a big outlier from inflating the
 *    spread and hiding itself. The floor (the metric's `minSpread`, and a
 *    per-transform minimum) stops a tight cluster — everyone at 50–55% —
 *    from producing huge z out of noise.
 * 3. Only the single most extreme player in a direction is a candidate
 *    (ties → nobody), so every award is an honest "most"/"least".
 * 4. extremeness = 1 − e^(−z/2)          (0 at the median, → 1 for big outliers)
 *    rarity      = 0.5 + 0.5·min(1, gap) (gap to the runner-up, in spread units)
 *    confidence  = n / (n + n½)          (n = the metric's own sample size)
 *    population  = min(1, (N − 1) / 4)   (dampens everything on tiny servers)
 *    reliability = per-metric constant   (observed 1.0 … loosely derived 0.8)
 * 5. Below z = 1.5 or the configured minimum score → not a candidate.
 */

export const MIN_Z = 1.5;

/**
 * Transform-level spread floors, on top of each metric's own minSpread:
 * on a log scale a player must differ by ~22% before z reaches 1, and on a
 * logit scale by ~7 percentage points around 50%. Without this, a tight
 * cluster (50, 52, 55, 58, 60) makes 50 look "unusually low".
 */
const TRANSFORM_FLOOR: Record<MetricTransform, number> = { log1p: 0.2, logit: 0.3, identity: 0 };
export const MIN_ELIGIBLE_PLAYERS = 3;
const LOGIT_EPS = 0.01;

export function transformValue(x: number, t: MetricTransform): number {
  switch (t) {
    case "log1p":
      return Math.log1p(Math.max(0, x));
    case "logit": {
      const p = Math.min(1 - LOGIT_EPS, Math.max(LOGIT_EPS, x));
      return Math.log(p / (1 - p));
    }
    case "identity":
      return x;
  }
}

export interface MetricEvaluation {
  candidates: Candidate[];
  diagnostics: MetricDiagnostics;
  /** Signed robust z per eligible player (used by meta metrics). */
  z: Map<string, number>;
}

export function evaluateMetric<F>(
  def: MetricDefinition<F>,
  players: readonly { key: string; features: F }[],
  minScore: number,
): MetricEvaluation {
  const rows = players.map(({ key, features }) => {
    const raw = def.value(features);
    const value = raw === null || !Number.isFinite(raw) ? null : raw;
    const sample = def.sample(features);
    let reason: string | undefined;
    if (value === null) reason = "no data";
    else if (sample < def.minSample) reason = `sample ${round(sample)} < ${def.minSample}`;
    return { playerKey: key, value, sample, eligible: reason === undefined, reason, percentile: undefined as number | undefined };
  });
  const eligible = rows.filter((r) => r.eligible) as (typeof rows[number] & { value: number })[];
  const diagnostics: MetricDiagnostics = { metricId: def.id, eligiblePlayers: eligible.length, rows };
  const z = new Map<string, number>();
  const candidates: Candidate[] = [];

  if (eligible.length < MIN_ELIGIBLE_PLAYERS) {
    diagnostics.note = `only ${eligible.length} eligible player(s); need ${MIN_ELIGIBLE_PLAYERS}`;
    return { candidates, diagnostics, z };
  }

  const N = eligible.length;
  const values = eligible.map((r) => r.value);
  for (const r of eligible) r.percentile = midRankPercentile(values, r.value);

  const stats = eligible.map((r, i) => {
    const others = eligible.filter((_, j) => j !== i);
    const tOthers = others.map((o) => transformValue(o.value, def.transform));
    const medRaw = median(others.map((o) => o.value));
    const medT = median(tOthers);
    const mad = 1.4826 * median(tOthers.map((t) => Math.abs(t - medT)));
    const sorted = [...tOthers].sort((a, b) => a - b);
    const iqr = (quantile(sorted, 0.75) - quantile(sorted, 0.25)) / 1.349;
    const floor = Math.max(
      Math.abs(transformValue(medRaw + def.minSpread, def.transform) - transformValue(medRaw, def.transform)),
      TRANSFORM_FLOOR[def.transform],
      1e-9,
    );
    const spread = Math.max(mad, iqr, floor);
    const t = transformValue(r.value, def.transform);
    const zi = (t - medT) / spread;
    z.set(r.playerKey, zi);
    return { r, t, zi, spread, medRaw };
  });

  const directions: Direction[] = [];
  if (def.high) directions.push("high");
  if (def.low) directions.push("low");
  const notes: string[] = [];

  for (const direction of directions) {
    const sign = direction === "high" ? 1 : -1;
    const ranked = [...stats].sort((a, b) => sign * (b.r.value - a.r.value));
    const top = ranked[0]!;
    const runnerUp = ranked[1]!;
    if (top.r.value === runnerUp.r.value) {
      notes.push(`${direction}: tie for the top spot`);
      continue;
    }
    const dz = sign * top.zi;
    if (dz < MIN_Z) {
      notes.push(`${direction}: most extreme player only z=${round(dz)}`);
      continue;
    }
    const gap = (sign * (top.t - transformValue(runnerUp.r.value, def.transform))) / top.spread;
    const extremeness = 1 - Math.exp(-dz / 2);
    const rarity = 0.5 + 0.5 * Math.min(1, gap);
    const confidence = top.r.sample / (top.r.sample + def.halfConfidenceAt);
    const populationFactor = Math.min(1, (N - 1) / 4);
    const score = extremeness * rarity * confidence * populationFactor * def.reliability;
    if (score < minScore) {
      notes.push(`${direction}: score ${round(score)} below ${minScore}`);
      continue;
    }
    candidates.push({
      metricId: def.id,
      family: def.family,
      playerKey: top.r.playerKey,
      direction,
      value: top.r.value,
      z: dz,
      percentile: top.r.percentile ?? 50,
      median: top.medRaw,
      gap,
      extremeness,
      rarity,
      confidence,
      populationFactor,
      reliability: def.reliability,
      score,
    });
  }
  if (notes.length) diagnostics.note = notes.join("; ");
  return { candidates, diagnostics, z };
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolated quantile of a sorted array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** Percentile with ties counted half: 0 = lowest, 100 = highest. */
export function midRankPercentile(values: readonly number[], v: number): number {
  if (values.length <= 1) return 50;
  const below = values.filter((x) => x < v).length;
  const equal = values.filter((x) => x === v).length;
  return ((below + (equal - 1) / 2) / (values.length - 1)) * 100;
}

const round = (x: number) => Math.round(x * 100) / 100;
