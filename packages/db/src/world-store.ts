import type { AdvancementProgress, PlayerProfileData, StatCategories } from "@smp/core";
import type { Sql } from "./executor";

/** Reads/writes for per-player world data (stats, advancements, profile). */
export function createWorldStore(sql: Sql) {
  return {
    /** path → {size, mtime} for change detection. */
    async knownFiles(): Promise<Map<string, { size: number; mtimeMs: number }>> {
      const rows = await sql.query<{ path: string; size_bytes: number; mtime: Date }>("select path, size_bytes, mtime from smp.world_files");
      return new Map(rows.map((r) => [r.path, { size: r.size_bytes, mtimeMs: r.mtime.getTime() }]));
    },

    async markFile(path: string, size: number, mtimeMs: number) {
      await sql.query(
        `insert into smp.world_files (path, size_bytes, mtime) values ($1, $2, $3)
         on conflict (path) do update set size_bytes = excluded.size_bytes, mtime = excluded.mtime, updated_at = now()`,
        [path, size, new Date(mtimeMs).toISOString()],
      );
    },

    async saveStats(uuid: string, dataVersion: number | null, stats: StatCategories, day: string) {
      const json = JSON.stringify(stats);
      await sql.transaction(async (tx) => {
        await tx.query(
          `insert into smp.player_world_stats (uuid, data_version, stats) values ($1::uuid, $2, $3::text::jsonb)
           on conflict (uuid) do update set data_version = excluded.data_version, stats = excluded.stats, updated_at = now()`,
          [uuid, dataVersion, json],
        );
        await tx.query(
          `insert into smp.player_world_stats_daily (uuid, day, stats) values ($1::uuid, $2::date, $3::text::jsonb)
           on conflict (uuid, day) do update set stats = excluded.stats`,
          [uuid, day, json],
        );
      });
    },

    async saveAdvancements(uuid: string, dataVersion: number | null, advancements: AdvancementProgress[]) {
      await sql.query(
        `insert into smp.player_world_advancements (uuid, data_version, advancements) values ($1::uuid, $2, $3::text::jsonb)
         on conflict (uuid) do update set data_version = excluded.data_version, advancements = excluded.advancements, updated_at = now()`,
        [uuid, dataVersion, JSON.stringify(advancements)],
      );
    },

    async saveProfile(uuid: string, p: PlayerProfileData) {
      await sql.query(
        `insert into smp.player_profile_data (uuid, xp_level, xp_total, seen_credits) values ($1::uuid, $2, $3, $4)
         on conflict (uuid) do update set xp_level = excluded.xp_level, xp_total = excluded.xp_total,
           seen_credits = excluded.seen_credits, updated_at = now()`,
        [uuid, p.xpLevel, p.xpTotal, p.seenCredits],
      );
    },

    /** Everything for the stats rebuild, keyed by lowercase UUID. */
    async loadAll(): Promise<{
      stats: Map<string, StatCategories>;
      advancements: Map<string, AdvancementProgress[]>;
      profiles: Map<string, PlayerProfileData>;
    }> {
      const [s, a, p] = await Promise.all([
        sql.query<{ uuid: string; stats: StatCategories }>("select uuid::text as uuid, stats from smp.player_world_stats"),
        sql.query<{ uuid: string; advancements: AdvancementProgress[] }>("select uuid::text as uuid, advancements from smp.player_world_advancements"),
        sql.query<{ uuid: string; xp_level: number | null; xp_total: number | null; seen_credits: boolean }>(
          "select uuid::text as uuid, xp_level, xp_total, seen_credits from smp.player_profile_data",
        ),
      ]);
      return {
        stats: new Map(s.map((r) => [r.uuid, r.stats])),
        advancements: new Map(a.map((r) => [r.uuid, r.advancements])),
        profiles: new Map(p.map((r) => [r.uuid, { xpLevel: r.xp_level, xpTotal: r.xp_total, seenCredits: r.seen_credits }])),
      };
    },
  };
}

export type WorldStore = ReturnType<typeof createWorldStore>;
