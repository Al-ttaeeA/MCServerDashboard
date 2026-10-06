import type { Highlight, PlayerStats, ServerStats, SessionEndReason } from "@smp/core";
import type { Sql } from "./executor";

/**
 * Read-side queries used by the API. Every query is a single indexed
 * lookup or range scan — the heavy lifting already happened at sync time.
 */

export interface PlayerRow {
  id: number;
  player_key: string;
  uuid: string | null;
  name: string;
  color_index: number;
  first_seen: Date;
  last_seen: Date;
  stats: PlayerStats | null;
  highlights: Highlight[] | null;
  online: boolean;
}

export interface SessionRow {
  player_key: string;
  start_ts: Date;
  end_ts: Date;
  duration_seconds: number;
  end_reason: SessionEndReason;
}

const PLAYER_SELECT = `
  select p.id, p.player_key, p.uuid::text as uuid, p.name, p.color_index, p.first_seen, p.last_seen,
         ps.stats, ps.highlights,
         exists (select 1 from smp.sessions s where s.player_id = p.id and s.end_reason = 'open') as online
  from smp.players p
  left join smp.player_stats ps on ps.player_id = p.id`;

export function createReadStore(sql: Sql) {
  return {
    /** Players who have actually played (at least one session). */
    async listPlayers(): Promise<PlayerRow[]> {
      return sql.query<PlayerRow>(
        `${PLAYER_SELECT}
         where exists (select 1 from smp.sessions s where s.player_id = p.id)
         order by p.color_index`,
      );
    },

    /** Looks a player up by UUID, player key, current name or former name (case-insensitive). */
    async findPlayer(idOrName: string): Promise<PlayerRow | null> {
      const [row] = await sql.query<PlayerRow>(
        `${PLAYER_SELECT}
         where p.player_key = $1 or p.uuid::text = lower($1) or lower(p.name) = lower($1)
            or p.id = (select n.player_id from smp.player_names n where lower(n.name) = lower($1)
                       order by n.last_seen desc limit 1)
         order by (lower(p.name) = lower($1)) desc
         limit 1`,
        [idOrName],
      );
      return row ?? null;
    },

    async formerNames(playerId: number, currentName: string): Promise<string[]> {
      const rows = await sql.query<{ name: string }>(
        "select name from smp.player_names where player_id = $1 and name <> $2 order by first_seen",
        [playerId, currentName],
      );
      return rows.map((r) => r.name);
    },

    async playersByKeys(keys: string[]): Promise<PlayerRow[]> {
      if (keys.length === 0) return [];
      return sql.query<PlayerRow>(
        `${PLAYER_SELECT} where p.player_key in (select jsonb_array_elements_text($1::text::jsonb))`,
        [JSON.stringify(keys)],
      );
    },

    /** Sessions overlapping [from, to), optionally for a subset of players. */
    async sessionsInRange(from: Date, to: Date, playerKeys?: string[]): Promise<SessionRow[]> {
      return sql.query<SessionRow>(
        `select p.player_key, s.start_ts, s.end_ts, s.duration_seconds, s.end_reason
         from smp.sessions s join smp.players p on p.id = s.player_id
         where s.start_ts < $2 and s.end_ts > $1
           and ($3::text::jsonb is null or p.player_key in (select jsonb_array_elements_text($3::text::jsonb)))
         order by s.start_ts`,
        [from.toISOString(), to.toISOString(), playerKeys ? JSON.stringify(playerKeys) : null],
      );
    },

    /** A player's sessions, newest first, keyset-paginated by start time. */
    async playerSessions(playerId: number, limit: number, before?: Date): Promise<SessionRow[]> {
      return sql.query<SessionRow>(
        `select p.player_key, s.start_ts, s.end_ts, s.duration_seconds, s.end_reason
         from smp.sessions s join smp.players p on p.id = s.player_id
         where s.player_id = $1 and ($2::timestamptz is null or s.start_ts < $2)
         order by s.start_ts desc
         limit $3`,
        [playerId, before?.toISOString() ?? null, limit],
      );
    },

    async activityExtent(): Promise<{ start: Date; end: Date } | null> {
      const [row] = await sql.query<{ start: Date | null; end: Date | null }>(
        "select min(start_ts) as start, max(end_ts) as end from smp.sessions",
      );
      return row?.start && row.end ? { start: row.start, end: row.end } : null;
    },

    async serverStats(): Promise<ServerStats | null> {
      const [row] = await sql.query<{ stats: ServerStats }>("select stats from smp.server_stats where id = 1");
      return row?.stats ?? null;
    },

    async lastSyncs(): Promise<{ last: { at: Date; status: "running" | "success" | "failed" } | null; lastSuccessAt: Date | null }> {
      const [last] = await sql.query<{ started_at: Date; finished_at: Date | null; status: "running" | "success" | "failed" }>(
        "select started_at, finished_at, status from smp.sync_runs order by started_at desc limit 1",
      );
      const [ok] = await sql.query<{ finished_at: Date }>(
        "select finished_at from smp.sync_runs where status = 'success' order by finished_at desc limit 1",
      );
      return {
        last: last ? { at: last.finished_at ?? last.started_at, status: last.status } : null,
        lastSuccessAt: ok?.finished_at ?? null,
      };
    },
  };
}

export type ReadStore = ReturnType<typeof createReadStore>;
