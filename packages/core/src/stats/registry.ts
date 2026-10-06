import type { PlayerStats } from "./types";

/**
 * Registry of player statistics that can be compared across players.
 *
 * Each definition says how to read one number out of `PlayerStats`, how to
 * format it, and which direction is "notable". Leaderboards, the timeline
 * popover highlights and (later) the significance algorithm all work off
 * this list, so adding a stat here makes it available everywhere.
 */
export interface StatDefinition {
  id: string;
  label: string;
  /** Short phrase used in highlight cards, e.g. "longest session". */
  noun: string;
  icon: StatIcon;
  unit: "duration" | "count" | "rate" | "ratio" | "days";
  value(stats: PlayerStats): number | null;
  /**
   * Which extremes are interesting: a huge playtime is notable, but so are
   * very few deaths. Used by leaderboards (sort order) and significance scoring.
   */
  interesting: "high" | "low" | "both";
}

export type StatIcon = "clock" | "star" | "skull" | "trophy" | "flame" | "moon" | "chat" | "calendar" | "bolt";

export const STAT_DEFINITIONS: readonly StatDefinition[] = [
  { id: "playtime", label: "Total playtime", noun: "played", icon: "clock", unit: "duration", value: (s) => s.playtimeSeconds, interesting: "both" },
  { id: "sessions", label: "Sessions", noun: "sessions", icon: "bolt", unit: "count", value: (s) => s.sessionCount, interesting: "high" },
  { id: "longest_session", label: "Longest session", noun: "longest session", icon: "star", unit: "duration", value: (s) => s.longestSession?.seconds ?? null, interesting: "high" },
  { id: "average_session", label: "Average session", noun: "average session", icon: "clock", unit: "duration", value: (s) => (s.sessionCount ? s.averageSessionSeconds : null), interesting: "both" },
  { id: "deaths", label: "Deaths", noun: "deaths", icon: "skull", unit: "count", value: (s) => s.deaths.total, interesting: "both" },
  { id: "deaths_per_hour", label: "Deaths per hour", noun: "deaths / hour", icon: "skull", unit: "rate", value: (s) => s.deaths.perHour, interesting: "both" },
  { id: "advancements", label: "Advancements", noun: "advancements", icon: "trophy", unit: "count", value: (s) => s.advancements.total, interesting: "high" },
  { id: "challenges", label: "Challenges completed", noun: "challenges", icon: "trophy", unit: "count", value: (s) => s.advancements.byKind.challenge, interesting: "high" },
  { id: "active_days", label: "Active days", noun: "active days", icon: "calendar", unit: "days", value: (s) => s.activeDays, interesting: "high" },
  { id: "longest_streak", label: "Longest streak", noun: "day streak", icon: "flame", unit: "days", value: (s) => s.longestStreakDays, interesting: "high" },
  { id: "night_share", label: "Night owl", noun: "of playtime after midnight", icon: "moon", unit: "ratio", value: (s) => (s.playtimeSeconds ? s.nightShare : null), interesting: "high" },
  { id: "chat_messages", label: "Chat messages", noun: "chat messages", icon: "chat", unit: "count", value: (s) => s.chat.messages, interesting: "high" },
];

export const statById = (id: string) => STAT_DEFINITIONS.find((d) => d.id === id);

/** "1 death" vs "2 deaths" for count-style nouns. */
export function statNoun(def: StatDefinition, value: number): string {
  return value === 1 && def.unit === "count" && def.noun.endsWith("s") ? def.noun.slice(0, -1) : def.noun;
}

export interface Highlight {
  statId: string;
  value: number;
  /** Placeholder score; the real significance algorithm will populate this. */
  score: number;
}

/**
 * PLACEHOLDER — picks the three highlight stats shown in the timeline popover.
 *
 * TODO(significance): replace with the population-relative significance
 * algorithm (percentile / robust deviation / reliability weighting). It will
 * receive every player's stats so it can compare against the server, which
 * is why the signature already takes the whole population.
 */
export function pickHighlights(
  playerKey: string,
  population: ReadonlyMap<string, PlayerStats>,
  count = 3,
): Highlight[] {
  const stats = population.get(playerKey);
  if (!stats) return [];
  const preferred = ["longest_session", "deaths", "advancements", "active_days", "chat_messages"];
  const out: Highlight[] = [];
  for (const id of preferred) {
    const value = statById(id)?.value(stats);
    if (value === null || value === undefined) continue;
    out.push({ statId: id, value, score: 0 });
    if (out.length === count) break;
  }
  return out;
}
