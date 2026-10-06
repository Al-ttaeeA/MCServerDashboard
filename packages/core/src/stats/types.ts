import type { DeathCategory } from "../parser/death-messages";
import type { AdvancementKind } from "../parser/types";

/**
 * Precomputed statistics, stored as JSON in `player_stats` / `server_stats`
 * by the sync job and returned as-is by the API.
 *
 * All values are derived from directly observed log events. Times are ISO
 * strings (UTC). Day/hour buckets use the configured community timezone, so
 * "Monday" means the same day for everyone regardless of who's viewing.
 */

export const STATS_VERSION = 1;

export interface DailyBucket {
  /** `YYYY-MM-DD` in the stats timezone. */
  date: string;
  seconds: number;
}

export interface PlayerStats {
  version: typeof STATS_VERSION;
  timeZone: string;

  // ── Playtime (derived from sessions) ──
  playtimeSeconds: number;
  sessionCount: number;
  averageSessionSeconds: number;
  medianSessionSeconds: number;
  longestSession: { seconds: number; start: string; end: string } | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Distinct days with any playtime. */
  activeDays: number;
  longestStreakDays: number;
  /** Consecutive active days ending today or yesterday (0 if the streak is broken). */
  currentStreakDays: number;
  /** Fraction of sessions whose end time is estimated (crash / missed leave / still open). */
  estimatedEndShare: number;

  /** Sparse, sorted ascending. */
  daily: DailyBucket[];
  /** Seconds played in each local hour of day (0–23). */
  hourly: number[];
  /** Seconds played per weekday, Monday = 0. */
  weekday: number[];
  /** Fraction of playtime between 00:00 and 05:59 local time. */
  nightShare: number;
  favoriteHour: number | null;

  // ── Deaths (observed: death messages) ──
  deaths: {
    total: number;
    /** Deaths per hour of playtime; null with too little playtime to be meaningful. */
    perHour: number | null;
    byCategory: { category: DeathCategory; count: number }[];
    topCauses: { label: string; count: number }[];
    topKiller: { name: string; count: number } | null;
    recent: { ts: string; message: string }[];
  };

  // ── Advancements (observed: broadcast messages) ──
  advancements: {
    total: number;
    byKind: Record<AdvancementKind, number>;
    list: { name: string; kind: AdvancementKind; earnedAt: string }[];
  };

  // ── Chat (observed: message counts only, never content) ──
  chat: {
    messages: number;
    perHour: number | null;
  };

  // ── Social (derived: overlapping sessions) ──
  /** The player this one has spent the most time online with. */
  topCompanion: { playerKey: string; seconds: number } | null;
}

export interface ServerStats {
  version: typeof STATS_VERSION;
  timeZone: string;
  playerCount: number;
  sessionCount: number;
  totalPlaytimeSeconds: number;
  peakConcurrent: { count: number; at: string } | null;
  busiestDay: { date: string; seconds: number } | null;
  daily: (DailyBucket & { players: number })[];
  hourly: number[];
  deaths: number;
  advancements: number;
  chatMessages: number;
  serverRuns: number;
  crashes: number;
  versions: { version: string; firstSeen: string }[];
  firstActivity: string | null;
  lastActivity: string | null;
}
