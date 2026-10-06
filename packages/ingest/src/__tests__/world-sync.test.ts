import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@smp/db";
import { migrate } from "@smp/db/migrate";
import { createPgliteSql } from "@smp/db/pglite";
import type { RemoteFile, ServerFs } from "../sources/types";
import { syncWorldData } from "../world-sync";

const U1 = "11111111-2222-4333-8444-555555555555";

/** In-memory server root. */
class MemoryFs implements ServerFs {
  description = "memory";
  files = new Map<string, { data: Buffer; mtimeMs: number }>();
  reads: string[] = [];
  put(path: string, data: Buffer | string, mtimeMs = 1000) {
    this.files.set(path, { data: Buffer.from(data), mtimeMs });
  }
  async list(dir: string): Promise<RemoteFile[]> {
    const prefix = dir.replace(/\/$/, "") + "/";
    const out = new Map<string, RemoteFile>();
    for (const [path, f] of this.files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [head, ...tail] = rest.split("/");
      out.set(head!, { name: head!, size: tail.length ? 0 : f.data.length, mtimeMs: f.mtimeMs, isDirectory: tail.length > 0 });
    }
    if (out.size === 0) throw new Error(`No such directory: ${dir}`);
    return [...out.values()];
  }
  async read(path: string) {
    this.reads.push(path);
    const f = this.files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f.data;
  }
  async close() {}
}

/** Root compound { XpLevel: int, XpTotal: int, seenCredits: byte } as gzipped NBT. */
function playerDat(level: number, total: number, credits: number): Buffer {
  const b: number[] = [10, 0, 0];
  const name = (s: string) => b.push(0, s.length, ...Buffer.from(s));
  const int = (n: string, v: number) => (b.push(3), name(n), b.push(v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255));
  int("XpLevel", level);
  int("XpTotal", total);
  b.push(1);
  name("seenCredits");
  b.push(credits, 0);
  return gzipSync(Buffer.from(b));
}

const statsJson = (playTicks: number) =>
  JSON.stringify({ stats: { "minecraft:custom": { "minecraft:play_time": playTicks }, "minecraft:mined": { "minecraft:diamond_ore": 7 } }, DataVersion: 5023 });
const advJson = JSON.stringify({
  "minecraft:story/mine_diamond": { criteria: { diamond: "2026-10-03 22:37:46 +0000" }, done: true },
  "minecraft:recipes/misc/stick": { criteria: { x: "2026-10-03 03:40:00 +0000" }, done: true },
  DataVersion: 5023,
});

let sql: Sql;
beforeEach(async () => {
  sql = await createPgliteSql();
  await migrate(sql);
});
afterEach(async () => {
  await sql.close();
});

const rows = (q: string) => sql.query<Record<string, unknown>>(q);

describe("syncWorldData", () => {
  it("reads the 26.1+ players/ layout using level-name from server.properties", async () => {
    const fs = new MemoryFs();
    fs.put("server.properties", "level-name=smp\n");
    fs.put(`smp/players/stats/${U1}.json`, statsJson(72000));
    fs.put(`smp/players/advancements/${U1}.json`, advJson);
    fs.put(`smp/players/data/${U1}.dat`, playerDat(24, 7371, 1));
    fs.put(`smp/players/data/${U1}.dat_old`, playerDat(1, 1, 0));

    const s = await syncWorldData(fs, sql, () => {}, Date.parse("2026-10-06T12:00:00Z"));
    expect(s).toMatchObject({ layout: "players-dir", worldDir: "smp", updated: { stats: 1, advancements: 1, playerdata: 1 }, failed: 0 });

    expect(await rows("select stats from smp.player_world_stats")).toEqual([{ stats: { custom: { play_time: 72000 }, mined: { diamond_ore: 7 } } }]);
    const [adv] = await rows("select advancements from smp.player_world_advancements");
    expect(adv!.advancements).toEqual([{ id: "story/mine_diamond", done: true, criteria: { diamond: "2026-10-03T22:37:46.000Z" } }]);
    expect(await rows("select xp_level, xp_total, seen_credits from smp.player_profile_data")).toEqual([
      { xp_level: 24, xp_total: 7371, seen_credits: true },
    ]);
    expect(await rows("select day::text as day from smp.player_world_stats_daily")).toEqual([{ day: "2026-10-06" }]);
  });

  it("falls back to the legacy layout", async () => {
    const fs = new MemoryFs();
    fs.put(`world/stats/${U1}.json`, statsJson(100));
    fs.put(`world/playerdata/${U1}.dat`, playerDat(3, 30, 0));
    const s = await syncWorldData(fs, sql, () => {});
    expect(s).toMatchObject({ layout: "legacy", updated: { stats: 1, advancements: 0, playerdata: 1 } });
  });

  it("skips unchanged files and re-reads changed ones", async () => {
    const fs = new MemoryFs();
    fs.put(`world/players/stats/${U1}.json`, statsJson(100), 1000);
    await syncWorldData(fs, sql, () => {});
    fs.reads = [];
    const again = await syncWorldData(fs, sql, () => {});
    expect(again.unchanged).toBe(1);
    expect(fs.reads.filter((p) => p.includes("stats"))).toEqual([]);

    fs.put(`world/players/stats/${U1}.json`, statsJson(200), 2000);
    await syncWorldData(fs, sql, () => {});
    expect(await rows("select stats->'custom'->>'play_time' as t from smp.player_world_stats")).toEqual([{ t: "200" }]);
  });

  it("reports a corrupt file without failing the sync", async () => {
    const fs = new MemoryFs();
    fs.put(`world/players/stats/${U1}.json`, "{ not json");
    const messages: string[] = [];
    const s = await syncWorldData(fs, sql, (m) => messages.push(m));
    expect(s.failed).toBe(1);
    expect(messages.join("\n")).toContain(U1);
  });

  it("returns cleanly when there's no world data at all", async () => {
    const s = await syncWorldData(new MemoryFs(), sql, () => {});
    expect(s.layout).toBeNull();
  });
});
