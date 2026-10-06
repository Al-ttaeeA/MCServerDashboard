import type { AwardsConfig } from "./types";

/**
 * Awards configuration. Edit and push to change what can be awarded.
 *
 * Sensitive categories (all ON by default, as agreed):
 * - "deaths"         death counts, death rates, embarrassing deaths
 * - "short_sessions" very short sessions (Commitment Issues …)
 * - "schedule"       late-night / overnight play
 * - "chat_volume"    how much / how little someone chats
 * - "chat_style"     message length, capitals, repetition (features only, never text)
 *
 * To turn a category off: add it to `disabledCategories`.
 * To turn off one award: add its metric id (see docs/awards.md) to `disabledMetrics`.
 */
export const AWARDS_CONFIG: AwardsConfig = {
  awardsPerPlayer: 3,
  minScore: 0.15,
  disabledCategories: [],
  disabledMetrics: [],
};
