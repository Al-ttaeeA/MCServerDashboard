import type { SessionEndReason } from "../sessions/build-sessions";
import type { Highlight } from "../stats/registry";
import type { PlayerStats, ServerStats } from "../stats/types";

/**
 * API contract between the Worker and the frontend.
 *
 * These shapes are deliberately independent of the database schema: the
 * API maps rows to DTOs, so tables can change without touching the UI.
 * All timestamps are ISO-8601 UTC strings.
 */

export interface PlayerRefDto {
  /** Stable id: Mojang UUID (or provisional key). Use `name` for URLs. */
  id: string;
  name: string;
  uuid: string | null;
  /** Hex colour from the fixed player palette. */
  color: string;
}

export interface PlayerSummaryDto extends PlayerRefDto {
  firstSeen: string;
  lastSeen: string;
  online: boolean;
  playtimeSeconds: number;
  sessionCount: number;
  highlights: Highlight[];
}

export interface PlayersResponse {
  players: PlayerSummaryDto[];
}

export interface PlayerDetailResponse {
  player: PlayerSummaryDto;
  /** Previous names (renames), oldest first. */
  formerNames: string[];
  stats: PlayerStats;
  /** Resolved name for stats.topCompanion. */
  topCompanion: (PlayerRefDto & { seconds: number }) | null;
}

export interface SessionDto {
  playerId: string;
  start: string;
  end: string;
  /** Seconds. For open sessions this is up to the last log line we saw. */
  duration: number;
  endReason: SessionEndReason;
  /** True when the end time is an estimate (crash, missed leave, still online). */
  estimated: boolean;
}

export interface SessionsResponse {
  sessions: SessionDto[];
  /** Pass as `before` to fetch the next (older) page; null when exhausted. */
  nextCursor: string | null;
}

export interface TimelineResponse {
  /** The window the sessions were selected for. */
  from: string;
  to: string;
  /** Earliest and latest activity on the server (for zoom-to-fit). */
  extent: { start: string; end: string } | null;
  players: PlayerRefDto[];
  sessions: SessionDto[];
}

export interface LeaderboardEntryDto {
  player: PlayerRefDto;
  value: number;
}

export interface LeaderboardDto {
  statId: string;
  label: string;
  unit: "duration" | "count" | "rate" | "ratio" | "days";
  entries: LeaderboardEntryDto[];
}

export interface LeaderboardsResponse {
  leaderboards: LeaderboardDto[];
}

export interface MetaResponse {
  lastSync: { at: string; status: "running" | "success" | "failed" } | null;
  /** Latest successful sync — "Last updated". */
  lastSuccessfulSyncAt: string | null;
  server: ServerStats | null;
  onlinePlayerIds: string[];
}

export interface ApiError {
  error: string;
}
