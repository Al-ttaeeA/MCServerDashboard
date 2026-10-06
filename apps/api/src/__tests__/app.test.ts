import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  LeaderboardsResponse,
  MetaResponse,
  PlayerDetailResponse,
  PlayersResponse,
  SessionsResponse,
  TimelineResponse,
} from "@smp/core";
import type { Sql } from "@smp/db";
import { migrate } from "@smp/db/migrate";
import { createPgliteSql } from "@smp/db/pglite";
import { runIngestion } from "@smp/ingest/pipeline";
import type { LogSource } from "@smp/ingest/sources/types";
import { createApp } from "../app";

const U_ALEX = "11111111-2222-4333-8444-555555555555";
const U_BEA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const line = (t: string, msg: string, thread = "Server thread/INFO") => `[${t}] [${thread}]: ${msg}\n`;
const auth = (t: string, n: string, u: string) => line(t, `UUID of player ${n} is ${u}`, "User Authenticator #1/INFO");

const DAY1 =
  line("10:00:00", "Starting minecraft server version 26.3") +
  auth("10:05:00", "Alex", U_ALEX) +
  line("10:05:01", "System chat: Alex joined the game") +
  auth("10:10:00", "Bea", U_BEA) +
  line("10:10:01", "System chat: Bea joined the game") +
  line("10:30:00", "System chat: Alex was slain by Zombie") +
  line("10:31:00", "System chat: Bea has made the advancement [Stone Age]") +
  line("11:05:01", "System chat: Alex left the game") +
  line("12:10:01", "System chat: Bea left the game");
const DAY2 = auth("09:00:00", "Alex", U_ALEX) + line("09:00:01", "System chat: Alex joined the game") + line("09:20:00", "Player Alex standing on air - force-sending blocks below");

let sql: Sql;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  sql = await createPgliteSql();
  await migrate(sql);
  const files = new Map([
    ["2026-10-05-1.log.gz", { data: gzipSync(DAY1), mtimeMs: Date.parse("2026-10-05T12:10:02Z") }],
    ["latest.log", { data: Buffer.from(DAY2), mtimeMs: Date.parse("2026-10-06T09:20:00Z") }],
  ]);
  const source: LogSource = {
    description: "memory",
    list: async () => [...files].map(([name, f]) => ({ name, size: f.data.length, mtimeMs: f.mtimeMs, isDirectory: false })),
    read: async (name) => files.get(name)!.data,
    close: async () => {},
  };
  await runIngestion({ source, sql, mode: "import", serverTimeZone: "UTC", statsTimeZone: "America/New_York" });
  app = createApp({ getSql: async () => ({ sql, release: async () => {} }) });
});
afterAll(async () => {
  await sql.close();
});

const get = async <T>(path: string, status = 200): Promise<T> => {
  const res = await app.request(path);
  expect(res.status, path).toBe(status);
  return (await res.json()) as T;
};

describe("API", () => {
  it("GET /api/players lists players with colours, playtime and online state", async () => {
    const { players } = await get<PlayersResponse>("/api/players");
    expect(players.map((p) => [p.name, p.id, p.online])).toEqual([
      ["Alex", U_ALEX, true],
      ["Bea", U_BEA, false],
    ]);
    expect(players[0]!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(players[0]!.playtimeSeconds).toBe(3600 + 19 * 60 + 59);
    expect(Array.isArray(players[0]!.awards)).toBe(true); // 2 players: too few for awards
  });

  it("GET /api/players/:id resolves by name (case-insensitive) or UUID", async () => {
    const byName = await get<PlayerDetailResponse>("/api/players/alex");
    const byUuid = await get<PlayerDetailResponse>(`/api/players/${U_ALEX}`);
    expect(byName.player.id).toBe(U_ALEX);
    expect(byUuid.player.name).toBe("Alex");
    expect(byName.stats.deaths.total).toBe(1);
    expect(byName.topCompanion).toMatchObject({ name: "Bea", seconds: 3600 - 5 * 60 });
  });

  it("GET /api/players/:id 404s for unknown players", async () => {
    expect(await get("/api/players/nobody", 404)).toEqual({ error: "Player not found" });
  });

  it("GET /api/players/:id/sessions paginates newest first", async () => {
    const page1 = await get<SessionsResponse>("/api/players/Alex/sessions?limit=1");
    expect(page1.sessions).toHaveLength(1);
    expect(page1.sessions[0]).toMatchObject({ endReason: "open", estimated: true });
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await get<SessionsResponse>(`/api/players/Alex/sessions?limit=1&before=${encodeURIComponent(page1.nextCursor!)}`);
    expect(page2.sessions[0]).toMatchObject({ endReason: "leave", duration: 3600 });
    expect(page2.nextCursor).toBeNull();
  });

  it("GET /api/timeline returns sessions overlapping a range", async () => {
    const all = await get<TimelineResponse>("/api/timeline");
    expect(all.sessions).toHaveLength(3);
    expect(all.extent).toEqual({ start: "2026-10-05T10:05:01.000Z", end: "2026-10-06T09:20:00.000Z" });

    const window = await get<TimelineResponse>("/api/timeline?from=2026-10-05T11:30:00Z&to=2026-10-05T13:00:00Z");
    expect(window.sessions.map((s) => s.playerId)).toEqual([U_BEA]);

    const filtered = await get<TimelineResponse>(`/api/timeline?players=${U_ALEX}`);
    expect(filtered.players.map((p) => p.name)).toEqual(["Alex"]);
    expect(filtered.sessions.every((s) => s.playerId === U_ALEX)).toBe(true);
  });

  it("GET /api/timeline validates input", async () => {
    await get("/api/timeline?from=not-a-date", 400);
    await get("/api/timeline?from=2026-10-06T00:00:00Z&to=2026-10-05T00:00:00Z", 400);
  });

  it("GET /api/leaderboards ranks players per stat", async () => {
    const { leaderboards } = await get<LeaderboardsResponse>("/api/leaderboards");
    const playtime = leaderboards.find((l) => l.statId === "playtime")!;
    expect(playtime.entries.map((e) => e.player.name)).toEqual(["Bea", "Alex"]);
    const deaths = leaderboards.find((l) => l.statId === "deaths")!;
    expect(deaths.entries[0]).toMatchObject({ player: { name: "Alex" }, value: 1 });
  });

  it("GET /api/meta reports last sync, server stats and who's online", async () => {
    const meta = await get<MetaResponse>("/api/meta");
    expect(meta.lastSync?.status).toBe("success");
    expect(meta.lastSuccessfulSyncAt).not.toBeNull();
    expect(meta.server).toMatchObject({ playerCount: 2, sessionCount: 3 });
    expect(meta.onlinePlayerIds).toEqual([U_ALEX]);
  });

  it("sets cache headers and 404s unknown routes as JSON", async () => {
    const res = await app.request("/api/players");
    expect(res.headers.get("cache-control")).toContain("max-age");
    expect(await get("/api/nope", 404)).toEqual({ error: "Not found" });
  });
});
