import { Hono, type Context } from "hono";
import {
  ESTIMATED_END_REASONS,
  STAT_DEFINITIONS,
  playerColor,
  type AwardsResponse,
  type LeaderboardsResponse,
  type MetaResponse,
  type PlayerDetailResponse,
  type PlayerRefDto,
  type PlayerSummaryDto,
  type PlayersResponse,
  type SessionDto,
  type SessionsResponse,
  type TimelineResponse,
} from "@smp/core";
import { createReadStore, type PlayerRow, type ReadStore, type SessionRow, type Sql } from "@smp/db";

/**
 * Runtime-agnostic API app. The Cloudflare Worker (src/index.ts) and the
 * local Node dev server (src/dev.ts) both mount it and only differ in how
 * they obtain a database connection.
 */
export interface AppDeps {
  /** Returns a database handle for this request (and a cleanup callback). */
  getSql(c: Context): Promise<{ sql: Sql; release: () => Promise<void> }>;
}

type Env = { Variables: { store: ReadStore } };

/** Data only changes every ~30 min, so short public caching is safe. */
const CACHE_HEADER = "public, max-age=60, s-maxage=120";

export function createApp(deps: AppDeps) {
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    const { sql, release } = await deps.getSql(c);
    c.set("store", createReadStore(sql));
    try {
      await next();
    } finally {
      await release();
    }
    if (c.res.status === 200) c.header("Cache-Control", CACHE_HEADER);
  });

  app.get("/meta", async (c) => {
    const store = c.get("store");
    const [syncs, server, players] = await Promise.all([store.lastSyncs(), store.serverStats(), store.listPlayers()]);
    const body: MetaResponse = {
      lastSync: syncs.last ? { at: syncs.last.at.toISOString(), status: syncs.last.status } : null,
      lastSuccessfulSyncAt: syncs.lastSuccessAt?.toISOString() ?? null,
      server,
      onlinePlayerIds: players.filter((p) => p.online).map(playerId),
    };
    return c.json(body);
  });

  app.get("/players", async (c) => {
    const players = await c.get("store").listPlayers();
    return c.json<PlayersResponse>({ players: players.map(toSummary) });
  });

  app.get("/players/:id", async (c) => {
    const store = c.get("store");
    const row = await store.findPlayer(c.req.param("id"));
    if (!row || !row.stats) return c.json({ error: "Player not found" }, 404);
    const companionKey = row.stats.topCompanion?.playerKey;
    const [formerNames, companions] = await Promise.all([
      store.formerNames(row.id, row.name),
      companionKey ? store.playersByKeys([companionKey]) : Promise.resolve([]),
    ]);
    const companion = companions[0];
    const body: PlayerDetailResponse = {
      player: toSummary(row),
      formerNames,
      stats: row.stats,
      topCompanion: companion && row.stats.topCompanion ? { ...toRef(companion), seconds: row.stats.topCompanion.seconds } : null,
    };
    return c.json(body);
  });

  app.get("/players/:id/sessions", async (c) => {
    const store = c.get("store");
    const row = await store.findPlayer(c.req.param("id"));
    if (!row) return c.json({ error: "Player not found" }, 404);
    const limit = clampInt(c.req.query("limit"), 1, 200, 50);
    const before = parseDate(c.req.query("before"));
    if (before === "invalid") return c.json({ error: "Invalid 'before' timestamp" }, 400);
    const rows = await store.playerSessions(row.id, limit + 1, before ?? undefined);
    const page = rows.slice(0, limit);
    const body: SessionsResponse = {
      sessions: page.map((s) => toSession(s, row.player_key)),
      nextCursor: rows.length > limit ? page[page.length - 1]!.start_ts.toISOString() : null,
    };
    return c.json(body);
  });

  app.get("/timeline", async (c) => {
    const store = c.get("store");
    const from = parseDate(c.req.query("from"));
    const to = parseDate(c.req.query("to"));
    if (from === "invalid" || to === "invalid") return c.json({ error: "Invalid 'from'/'to' timestamp" }, 400);
    const [players, extent] = await Promise.all([store.listPlayers(), store.activityExtent()]);

    const wanted = c.req.query("players")?.split(",").filter(Boolean);
    const selected = wanted ? players.filter((p) => wanted.includes(playerId(p)) || wanted.includes(p.name)) : players;
    const rangeFrom = from ?? extent?.start ?? new Date(0);
    const rangeTo = to ?? extent?.end ?? new Date();
    if (rangeTo <= rangeFrom) return c.json({ error: "'to' must be after 'from'" }, 400);

    const sessions = await store.sessionsInRange(rangeFrom, rangeTo, wanted ? selected.map((p) => p.player_key) : undefined);
    const idByKey = new Map(players.map((p) => [p.player_key, playerId(p)]));
    const body: TimelineResponse = {
      from: rangeFrom.toISOString(),
      to: rangeTo.toISOString(),
      extent: extent ? { start: extent.start.toISOString(), end: extent.end.toISOString() } : null,
      players: selected.map(toRef),
      sessions: sessions.map((s) => toSession(s, idByKey.get(s.player_key) ?? s.player_key)),
    };
    return c.json(body);
  });

  app.get("/awards", async (c) => {
    const store = c.get("store");
    const [snapshot, players] = await Promise.all([store.awardsSnapshot(), store.listPlayers()]);
    if (!snapshot) {
      return c.json<AwardsResponse>({ computedAt: null, awards: [], records: [], metrics: [] });
    }
    const refByKey = new Map(players.map((p) => [p.player_key, toRef(p)]));
    const { data } = snapshot;
    const titleOf = new Map(data.metrics.flatMap((m) => [
      [`${m.id}:high`, m.high],
      [`${m.id}:low`, m.low],
    ]));
    const body: AwardsResponse = {
      computedAt: snapshot.computedAt.toISOString(),
      awards: data.assignments
        .filter((a) => refByKey.has(a.playerKey))
        .map((a) => ({ ...a.award, player: refByKey.get(a.playerKey)! }))
        .sort((a, b) => b.score - a.score),
      records: data.records.flatMap((r) => {
        const player = refByKey.get(r.playerKey);
        const t = titleOf.get(`${r.metricId}:${r.direction}`);
        return player && t ? [{ metricId: r.metricId, title: t.title, emoji: t.emoji, direction: r.direction, player, value: r.value, formatted: r.formatted }] : [];
      }),
      metrics: data.metrics,
    };
    if (c.req.query("debug") === "1") {
      const won = new Set(data.assignments.map((a) => `${a.award.metricId}:${a.playerKey}`));
      body.debug = {
        candidates: data.candidates.flatMap((cand) => {
          const player = refByKey.get(cand.playerKey);
          return player ? [{ ...cand, player, won: won.has(`${cand.metricId}:${cand.playerKey}`) }] : [];
        }),
        diagnostics: data.diagnostics.map((d) => ({ ...d, rows: d.rows.map((r) => ({ ...r, player: refByKey.get(r.playerKey) ?? null })) })),
      };
    }
    return c.json(body);
  });

  app.get("/leaderboards", async (c) => {
    const players = (await c.get("store").listPlayers()).filter((p) => p.stats);
    const body: LeaderboardsResponse = {
      leaderboards: STAT_DEFINITIONS.map((def) => ({
        statId: def.id,
        label: def.label,
        unit: def.unit,
        entries: players
          .map((p) => ({ player: toRef(p), value: def.value(p.stats!) }))
          .filter((e): e is { player: PlayerRefDto; value: number } => e.value !== null)
          .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name)),
      })),
    };
    return c.json(body);
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Internal error" }, 500);
  });

  return app;
}

const playerId = (p: Pick<PlayerRow, "uuid" | "player_key">) => p.uuid ?? p.player_key;

function toRef(p: PlayerRow): PlayerRefDto {
  return { id: playerId(p), name: p.name, uuid: p.uuid, color: playerColor(p.color_index) };
}

function toSummary(p: PlayerRow): PlayerSummaryDto {
  return {
    ...toRef(p),
    firstSeen: p.first_seen.toISOString(),
    lastSeen: p.last_seen.toISOString(),
    online: p.online,
    playtimeSeconds: p.stats?.playtimeSeconds ?? 0,
    sessionCount: p.stats?.sessionCount ?? 0,
    awards: p.awards ?? [],
  };
}

function toSession(s: SessionRow, id: string): SessionDto {
  return {
    playerId: id,
    start: s.start_ts.toISOString(),
    end: s.end_ts.toISOString(),
    duration: s.duration_seconds,
    endReason: s.end_reason,
    estimated: ESTIMATED_END_REASONS.has(s.end_reason),
  };
}

function parseDate(v: string | undefined): Date | null | "invalid" {
  if (v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

function clampInt(v: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}
