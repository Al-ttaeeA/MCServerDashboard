import { gunzipSync } from "node:zlib";
import {
  levelNameFromProperties,
  parseAdvancementsFile,
  parsePlayerData,
  parseStatsFile,
  uuidFromWorldFile,
  worldLayouts,
  type WorldFileKind,
  type WorldLayout,
} from "@smp/core";
import { createWorldStore, type Sql } from "@smp/db";
import type { RemoteFile, ServerFs } from "./sources/types";

export interface WorldSyncSummary {
  layout: WorldLayout["name"] | null;
  worldDir: string | null;
  updated: Record<WorldFileKind, number>;
  unchanged: number;
  failed: number;
}

/**
 * Pulls per-player statistics, advancements and (a few) player-data fields.
 *
 * Steps: read `level-name` from server.properties → probe the 26.1+ layout,
 * then the legacy one → for each `<uuid>.json|.dat`, download only if its
 * size or mtime changed since last time → parse → upsert.
 *
 * A file that fails to parse is reported and skipped; it never aborts the
 * log sync (world files can be mid-write when the server autosaves).
 */
export async function syncWorldData(fs: ServerFs, sql: Sql, log: (msg: string) => void, now = Date.now()): Promise<WorldSyncSummary> {
  const store = createWorldStore(sql);
  const summary: WorldSyncSummary = { layout: null, worldDir: null, updated: { stats: 0, advancements: 0, playerdata: 0 }, unchanged: 0, failed: 0 };

  let levelName = "world";
  try {
    levelName = levelNameFromProperties(utf8(await fs.read("server.properties")));
  } catch {
    log("  server.properties not readable; assuming world folder 'world'");
  }

  let layout: WorldLayout | null = null;
  let listings: Partial<Record<WorldFileKind, RemoteFile[]>> = {};
  for (const candidate of worldLayouts(levelName)) {
    try {
      listings = { stats: await fs.list(candidate.dirs.stats) };
      layout = candidate;
      break;
    } catch {
      /* try the next layout */
    }
  }
  if (!layout) {
    log(`  No player statistics folder found under '${levelName}/' — skipping world data`);
    return summary;
  }
  summary.layout = layout.name;
  summary.worldDir = levelName;
  for (const kind of ["advancements", "playerdata"] as const) {
    listings[kind] = await fs.list(layout.dirs[kind]).catch(() => []);
  }

  const known = await store.knownFiles();
  const day = new Date(now).toISOString().slice(0, 10);

  for (const kind of ["stats", "advancements", "playerdata"] as const) {
    for (const file of listings[kind] ?? []) {
      const uuid = file.isDirectory ? null : uuidFromWorldFile(file.name);
      if (!uuid) continue;
      if (kind === "playerdata" ? !file.name.endsWith(".dat") : !file.name.endsWith(".json")) continue;
      const path = `${layout.dirs[kind]}/${file.name}`;
      const prev = known.get(path);
      if (prev && prev.size === file.size && prev.mtimeMs === file.mtimeMs) {
        summary.unchanged++;
        continue;
      }
      try {
        const buf = await fs.read(path);
        if (kind === "stats") {
          const parsed = parseStatsFile(utf8(buf));
          await store.saveStats(uuid, parsed.dataVersion, parsed.stats, day);
        } else if (kind === "advancements") {
          const parsed = parseAdvancementsFile(utf8(buf));
          await store.saveAdvancements(uuid, parsed.dataVersion, parsed.advancements);
        } else {
          await store.saveProfile(uuid, parsePlayerData(gunzipSync(buf)));
        }
        await store.markFile(path, file.size, file.mtimeMs);
        summary.updated[kind]++;
      } catch (err) {
        summary.failed++;
        log(`  ! ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return summary;
}

const utf8 = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
