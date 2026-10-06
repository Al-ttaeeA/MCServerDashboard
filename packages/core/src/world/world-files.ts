import { nbtNumber, readNbt } from "./nbt";

/**
 * Vanilla per-player world files and where they live.
 *
 * Verified on our 26.3 server (DataVersion 5023):
 *   <world>/players/stats/<uuid>.json
 *   <world>/players/advancements/<uuid>.json
 *   <world>/players/data/<uuid>.dat         (gzipped NBT; .dat_old = previous save)
 *
 * Before 26.1 the same files lived in <world>/stats, <world>/advancements and
 * <world>/playerdata. The ingester probes for the modern layout first and
 * falls back to the legacy one, so older servers keep working.
 */
export type WorldFileKind = "stats" | "advancements" | "playerdata";

export interface WorldLayout {
  name: "players-dir" | "legacy";
  dirs: Record<WorldFileKind, string>;
}

export function worldLayouts(worldDir: string): WorldLayout[] {
  const w = worldDir.replace(/\/+$/, "");
  return [
    { name: "players-dir", dirs: { stats: `${w}/players/stats`, advancements: `${w}/players/advancements`, playerdata: `${w}/players/data` } },
    { name: "legacy", dirs: { stats: `${w}/stats`, advancements: `${w}/advancements`, playerdata: `${w}/playerdata` } },
  ];
}

/** `level-name` from server.properties (the world folder), default "world". */
export function levelNameFromProperties(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#") || !line.startsWith("level-name")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const value = line.slice(eq + 1).trim();
    if (value) return value;
  }
  return "world";
}

const UUID_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(json|dat)$/i;

/** `<uuid>.json` / `<uuid>.dat` → uuid (lowercase). `.dat_old` backups and anything else → null. */
export function uuidFromWorldFile(name: string): string | null {
  const m = UUID_FILE.exec(name);
  return m ? m[1]!.toLowerCase() : null;
}

// ── Statistics ──────────────────────────────────────────────────────────

/**
 * `{ "minecraft:mined": { "minecraft:stone": 12 } }` with the namespace
 * stripped from vanilla keys: `{ mined: { stone: 12 } }`. Modded or datapack
 * namespaces keep their prefix. A key that's absent means 0 — vanilla only
 * writes a statistic once it becomes non-zero.
 */
export type StatCategories = Record<string, Record<string, number>>;

export interface PlayerStatsFile {
  dataVersion: number | null;
  stats: StatCategories;
}

const stripNs = (k: string) => (k.startsWith("minecraft:") ? k.slice(10) : k);

export function parseStatsFile(json: string): PlayerStatsFile {
  const raw = JSON.parse(json) as { stats?: Record<string, Record<string, unknown>>; DataVersion?: unknown };
  const stats: StatCategories = {};
  for (const [category, entries] of Object.entries(raw.stats ?? {})) {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(entries ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) out[stripNs(key)] = value;
    }
    stats[stripNs(category)] = out;
  }
  return { dataVersion: typeof raw.DataVersion === "number" ? raw.DataVersion : null, stats };
}

// ── Advancements ────────────────────────────────────────────────────────

export interface AdvancementProgress {
  /** e.g. `story/mine_diamond` (vanilla namespace stripped). */
  id: string;
  done: boolean;
  /** criterion → ISO timestamp it was completed. */
  criteria: Record<string, string>;
}

/**
 * Parses an advancements file, dropping recipe unlocks (`recipes/…`), which
 * are ~95% of entries and not advancements a player would recognise.
 * Timestamps like `2026-10-03 22:37:46 +0000` become ISO strings.
 */
export function parseAdvancementsFile(json: string): { dataVersion: number | null; advancements: AdvancementProgress[] } {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const advancements: AdvancementProgress[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key === "DataVersion" || typeof value !== "object" || value === null) continue;
    const id = stripNs(key);
    if (id.startsWith("recipes/")) continue;
    const v = value as { done?: unknown; criteria?: Record<string, unknown> };
    const criteria: Record<string, string> = {};
    for (const [c, ts] of Object.entries(v.criteria ?? {})) {
      const iso = typeof ts === "string" ? parseAdvancementTime(ts) : null;
      if (iso) criteria[stripNs(c)] = iso;
    }
    advancements.push({ id, done: v.done === true, criteria });
  }
  advancements.sort((a, b) => a.id.localeCompare(b.id));
  return { dataVersion: typeof raw.DataVersion === "number" ? raw.DataVersion : null, advancements };
}

export function parseAdvancementTime(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** When an advancement was completed: the latest of its criteria timestamps (only if done). */
export function completedAt(a: AdvancementProgress): string | null {
  if (!a.done) return null;
  const times = Object.values(a.criteria).sort();
  return times.at(-1) ?? null;
}

// ── Player data (NBT) ───────────────────────────────────────────────────

/**
 * The only fields we keep from player NBT. Position, inventory, ender chest
 * and the rest are deliberately ignored — this site is public and a player's
 * position would reveal their base.
 */
export interface PlayerProfileData {
  xpLevel: number | null;
  xpTotal: number | null;
  /** Has seen the End credits, i.e. beaten the Ender Dragon. */
  seenCredits: boolean;
}

/** @param nbtBytes already-decompressed NBT */
export function parsePlayerData(nbtBytes: Uint8Array): PlayerProfileData {
  const root = readNbt(nbtBytes);
  return {
    xpLevel: nbtNumber(root.XpLevel),
    xpTotal: nbtNumber(root.XpTotal),
    seenCredits: nbtNumber(root.seenCredits) === 1,
  };
}
