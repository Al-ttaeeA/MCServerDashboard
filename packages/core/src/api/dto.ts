import type { SessionEndReason } from "../sessions/build-sessions";
import type { Award, Candidate, MetricDiagnostics } from "../awards/types";
import type { MetricInfo } from "../awards/engine";
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
  /** Up to three awards chosen by the significance algorithm. */
  awards: Award[];
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

/** Server-wide awards snapshot as stored by the sync (player keys, not DTOs). */
export interface AwardsSnapshot {
  metrics: MetricInfo[];
  assignments: { playerKey: string; award: Award }[];
  /** #1 per metric and direction, whether or not it was awarded. */
  records: { metricId: string; direction: "high" | "low"; playerKey: string; value: number; formatted: string }[];
  candidates: Candidate[];
  diagnostics: MetricDiagnostics[];
}

export interface AwardsResponse {
  computedAt: string | null;
  awards: (Award & { player: PlayerRefDto })[];
  records: { metricId: string; title: string; emoji: string; direction: "high" | "low"; player: PlayerRefDto; value: number; formatted: string }[];
  metrics: MetricInfo[];
  /** Only with ?debug=1. */
  debug?: {
    candidates: (Candidate & { player: PlayerRefDto; won: boolean })[];
    diagnostics: (Omit<MetricDiagnostics, "rows"> & { rows: (MetricDiagnostics["rows"][number] & { player: PlayerRefDto | null })[] })[];
  };
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
