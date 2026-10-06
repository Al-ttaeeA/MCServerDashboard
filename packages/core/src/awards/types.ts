/**
 * Awards: types shared by the metric catalog, significance scoring and the
 * allocator. See docs/awards.md for the full model.
 */

/** Where a metric's number ultimately comes from. */
export type MetricSource = "LOG" | "PLAYER_STATS" | "ADVANCEMENTS" | "PLAYER_DATA" | "DERIVED";

export type MetricUnit =
  | "duration" // seconds
  | "hours"
  | "count"
  | "ratio" // 0..1
  | "per_hour"
  | "days"
  | "km"
  | "clock" // hours after noon (0 = 12:00, 12 = 00:00, 15 = 03:00)
  | "score";

/**
 * How values are normalised before comparing players:
 * - `log1p`: heavy right-skewed counts/durations (blocks mined, kills) — the
 *   difference between 10 and 100 matters as much as 1,000 vs 10,000.
 * - `logit`: shares in 0..1 (night share) — 2% vs 10% is a bigger deal than 50% vs 58%.
 * - `identity`: already well-behaved (clock times, entropy, composite scores).
 */
export type MetricTransform = "log1p" | "logit" | "identity";

export type MetricFamily =
  | "playtime"
  | "sessions"
  | "schedule"
  | "deaths"
  | "mining"
  | "items"
  | "movement"
  | "combat"
  | "progression"
  | "chat"
  | "social"
  | "meta";

/** Categories that can be switched off in awards config (all on by default). */
export type SensitiveCategory = "deaths" | "short_sessions" | "schedule" | "chat_volume" | "chat_style";

export interface ExplainContext {
  name: string;
  value: number;
  /** `value` formatted in the metric's unit. */
  formatted: string;
  /** Count as a frequency: "once", "twice", "5 times". */
  times: string;
  /** Median of the other eligible players (raw units). */
  median: number;
  medianFormatted: string;
  /** "3.4× the server median" / "while everyone else is at zero" … */
  comparison: string;
  /** Metric-specific extras (e.g. the Server Couple's partner). */
  extra: Record<string, string | number>;
}

export interface AwardTitle {
  title: string;
  emoji: string;
  /** Short line for cards: "8h 14m longest session". */
  line(c: ExplainContext): string;
  /** One or two sentences for the profile. Deterministic, no LLM. */
  explain(c: ExplainContext): string;
}

export interface MetricDefinition<F = unknown> {
  id: string;
  family: MetricFamily;
  /** Primary data source(s). DERIVED means computed from other observed data. */
  source: MetricSource;
  /** Plain-language formula, shown in docs and the debug view. */
  formula: string;
  unit: MetricUnit;
  transform: MetricTransform;
  /**
   * Smallest difference (raw units) that's meaningful for this metric. Acts as
   * a floor on the spread, so a tightly clustered server doesn't produce
   * awards out of noise.
   */
  minSpread: number;
  /** Value for a player, or null when the underlying data doesn't exist. */
  value(f: F): number | null;
  /** Sample size behind the value (sessions, deaths, hours, messages…). */
  sample(f: F): number;
  /** Below this sample the player is NOT ELIGIBLE. */
  minSample: number;
  /** Sample at which confidence reaches 50% (confidence = n / (n + halfConfidenceAt)). */
  halfConfidenceAt: number;
  /** 0..1 — how trustworthy the measurement itself is. */
  reliability: number;
  high?: AwardTitle;
  low?: AwardTitle;
  sensitive?: SensitiveCategory;
  /** Extra values for explanation templates (computed for the winner only). */
  extra?(f: F): Record<string, string | number>;
}

export type Direction = "high" | "low";

/** One player × metric × direction, with every number behind its score. */
export interface Candidate {
  metricId: string;
  family: MetricFamily;
  playerKey: string;
  direction: Direction;
  value: number;
  /** Robust z against everyone else (leave-one-out), in the award's direction. */
  z: number;
  /** Mid-rank percentile among eligible players (0–100). */
  percentile: number;
  median: number;
  /** Separation from the runner-up, in spread units. */
  gap: number;
  extremeness: number;
  rarity: number;
  confidence: number;
  populationFactor: number;
  reliability: number;
  score: number;
}

export interface MetricDiagnostics {
  metricId: string;
  eligiblePlayers: number;
  /** Why no candidate came out of this metric, if none did. */
  note?: string;
  rows: {
    playerKey: string;
    value: number | null;
    sample: number;
    eligible: boolean;
    reason?: string;
    percentile?: number;
  }[];
}

export interface Award {
  metricId: string;
  title: string;
  emoji: string;
  direction: Direction;
  value: number;
  formatted: string;
  line: string;
  explanation: string;
  percentile: number;
  median: number;
  /** value ÷ median when meaningful. */
  ratioToMedian: number | null;
  score: number;
}

export interface AwardsConfig {
  awardsPerPlayer: number;
  /** Candidates below this significance are never awarded. */
  minScore: number;
  disabledCategories: SensitiveCategory[];
  disabledMetrics: string[];
}
