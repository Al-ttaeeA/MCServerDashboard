import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "@smp/db";
import { migrate } from "@smp/db/migrate";
import { createPgliteSql } from "@smp/db/pglite";
import { runIngestion } from "../pipeline";
import type { LogSource, RemoteFile } from "../sources/types";

/** A fake server log directory we can mutate between syncs. */
class MemorySource implements LogSource {
  description = "memory";
  files = new Map<string, { data: Buffer; mtimeMs: number }>();
  reads: string[] = [];
  put(name: string, text: string, mtimeIso: string) {
    const data = name.endsWith(".gz") ? gzipSync(Buffer.from(text)) : Buffer.from(text);
    this.files.set(name, { data, mtimeMs: Date.parse(mtimeIso) });
  }
  /** Simulates log4j rotating latest.log into a dated .gz. */
  rotate(to: string) {
    const latest = this.files.get("latest.log")!;
    this.files.delete("latest.log");
    this.files.set(to, { data: gzipSync(latest.data), mtimeMs: latest.mtimeMs });
  }
  async list(): Promise<RemoteFile[]> {
    return [...this.files].map(([name, f]) => ({ name, size: f.data.length, mtimeMs: f.mtimeMs }));
  }
  async read(name: string) {
    this.reads.push(name);
    return this.files.get(name)!.data;
  }
  async close() {}
}

const U_ALEX = "11111111-2222-4333-8444-555555555555";
const U_BEA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const line = (t: string, msg: string, thread = "Server thread/INFO") => `[${t}] [${thread}]: ${msg}\n`;
const auth = (t: string, name: string, uuid: string) => line(t, `UUID of player ${name} is ${uuid}`, "User Authenticator #1/INFO");

const DAY1 =
  line("10:00:00", "Starting minecraft server version 26.3") +
  line("10:00:03", 'Done (2.5s)! For help, type "help"') +
  auth("10:05:00", "Alex", U_ALEX) +
  line("10:05:01", "Alex[/203.0.113.1:5000] logged in with entity id 1 at (0.5, 64.0, 0.5)") +
  line("10:05:01", "System chat: Alex joined the game") +
  line("10:30:00", "System chat: Alex was slain by Zombie") +
  line("10:40:00", "<Alex> hello") +
  line("11:05:01", "Alex lost connection: Disconnected") +
  line("11:05:01", "System chat: Alex left the game");

let sql: Sql;
let source: MemorySource;
beforeEach(async () => {
  sql = await createPgliteSql();
  await migrate(sql);
  source = new MemorySource();
});
afterEach(async () => {
  await sql.close();
});

const sync = (extra: Partial<Parameters<typeof runIngestion>[0]> = {}) =>
  runIngestion({
    source,
    sql,
    mode: "sync",
    serverTimeZone: "UTC",
    statsTimeZone: "America/New_York",
    now: () => Date.parse("2026-10-06T12:00:00Z"),
    ...extra,
  });
const count = async (table: string) => (await sql.query<{ n: number }>(`select count(*)::int as n from smp.${table}`))[0]!.n;

describe("runIngestion", () => {
  it("imports a log, reconstructs sessions and computes stats", async () => {
    source.put("2026-10-05-1.log.gz", DAY1, "2026-10-05T11:05:02Z");
    const s = await sync();
    expect(s).toMatchObject({ filesProcessed: 1, players: 1, sessions: 1, newIssues: 0 });
    expect(s.counts).toMatchObject({ JOIN: 1, LEAVE: 1, DEATH: 1, CHAT: 1 });

    const [session] = await sql.query<{ start_ts: Date; duration_seconds: number; end_reason: string }>(
      "select start_ts, duration_seconds, end_reason from smp.sessions",
    );
    expect(session).toMatchObject({ duration_seconds: 3600, end_reason: "leave" });
    expect(session!.start_ts.toISOString()).toBe("2026-10-05T10:05:01.000Z");

    const [player] = await sql.query<{ name: string; uuid: string; color_index: number }>("select name, uuid, color_index from smp.players");
    expect(player).toEqual({ name: "Alex", uuid: U_ALEX, color_index: 0 });

    const [stats] = await sql.query<{ stats: { playtimeSeconds: number; deaths: { total: number } } }>("select stats from smp.player_stats");
    expect(stats!.stats.playtimeSeconds).toBe(3600);
    expect(stats!.stats.deaths.total).toBe(1);

    const [death] = await sql.query<{ category: string }>("select category from smp.deaths");
    expect(death!.category).toBe("mob");
  });

  it("never stores IPs or chat content", async () => {
    source.put("2026-10-05-1.log.gz", DAY1, "2026-10-05T11:05:02Z");
    await sync();
    const dump = JSON.stringify(await sql.query("select data from smp.events"));
    expect(dump).not.toContain("203.0.113.1");
    expect(dump).not.toContain("hello");
  });

  it("is idempotent: running twice changes nothing and skips downloads", async () => {
    source.put("2026-10-05-1.log.gz", DAY1, "2026-10-05T11:05:02Z");
    await sync();
    const before = { events: await count("events"), sessions: await count("sessions"), players: await count("players") };
    source.reads = [];
    const second = await sync();
    expect(second).toMatchObject({ filesProcessed: 0, filesSkipped: 1, insertedEvents: 0 });
    expect(source.reads).toEqual([]); // completed .gz not even downloaded
    expect({ events: await count("events"), sessions: await count("sessions"), players: await count("players") }).toEqual(before);
  });

  it("appends only new lines of a growing latest.log, then adopts it when rotated", async () => {
    const part1 = DAY1.split("\n").slice(0, 5).join("\n") + "\n"; // through Alex joining
    source.put("latest.log", part1, "2026-10-05T10:05:02Z");
    const s1 = await sync();
    expect(s1).toMatchObject({ sessions: 1, openSessions: 1 });

    source.put("latest.log", DAY1, "2026-10-05T11:05:02Z");
    const s2 = await sync();
    expect(s2.newLines).toBe(4);
    expect(s2).toMatchObject({ sessions: 1, openSessions: 0 });

    // Server restarts: latest.log is gzipped, a new latest.log begins.
    source.rotate("2026-10-05-1.log.gz");
    source.put(
      "latest.log",
      line("12:00:00", "Starting minecraft server version 26.3") + auth("12:01:00", "Bea", U_BEA) + line("12:01:01", "System chat: Bea joined the game"),
      "2026-10-05T12:01:02Z",
    );
    const s3 = await sync();
    expect(s3.newLines).toBe(3); // the .gz contributed nothing new
    expect(await count("log_files")).toBe(2);
    expect(await count("events")).toBe(9 + 3);
    const files = await sql.query<{ source_name: string; is_complete: boolean; seq: number | null }>(
      "select source_name, is_complete, seq from smp.log_files order by id",
    );
    expect(files).toEqual([
      { source_name: "2026-10-05-1.log.gz", is_complete: true, seq: 1 },
      { source_name: "latest.log", is_complete: false, seq: null },
    ]);
    expect(s3).toMatchObject({ players: 2, sessions: 2, openSessions: 1 });
  });

  it("ignores an incomplete trailing line in latest.log until it's complete", async () => {
    source.put("latest.log", DAY1 + "[11:06:00] [Server thread/INFO]: System chat: Alex joi", "2026-10-05T11:06:00Z");
    const s1 = await sync();
    source.put("latest.log", DAY1 + line("11:06:00", "System chat: Alex joined the game"), "2026-10-05T11:06:01Z");
    const s2 = await sync();
    expect(s1.counts.JOIN).toBe(1);
    expect(s2.counts.JOIN).toBe(1);
    expect(s2.openSessions).toBe(1);
  });

  it("closes sessions at the last log line when the server crashes", async () => {
    const crashed =
      line("10:00:00", "Starting minecraft server version 26.3") +
      auth("10:05:00", "Alex", U_ALEX) +
      line("10:05:01", "System chat: Alex joined the game") +
      line("10:50:00", "Player Alex standing on air - force-sending blocks below");
    source.put("2026-10-05-1.log.gz", crashed, "2026-10-05T10:50:00Z");
    source.put("latest.log", line("13:00:00", "Starting minecraft server version 26.3"), "2026-10-05T13:00:00Z");
    await sync();
    const rows = await sql.query<{ end_reason: string; end_ts: Date }>("select end_reason, end_ts from smp.sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.end_reason).toBe("crash");
    expect(rows[0]!.end_ts.toISOString()).toBe("2026-10-05T10:50:00.000Z");
    const runs = await sql.query<{ end_reason: string }>("select end_reason from smp.server_runs order by start_ts");
    expect(runs.map((r) => r.end_reason)).toEqual(["crash", "open"]);
  });

  it("keeps a player's colour stable as new players appear", async () => {
    source.put("2026-10-05-1.log.gz", DAY1, "2026-10-05T11:05:02Z");
    await sync();
    source.put(
      "latest.log",
      auth("12:00:00", "Bea", U_BEA) + line("12:00:01", "System chat: Bea joined the game") + line("12:30:00", "System chat: Bea left the game"),
      "2026-10-05T12:30:00Z",
    );
    await sync();
    const colors = await sql.query<{ name: string; color_index: number }>("select name, color_index from smp.players order by name");
    expect(colors).toEqual([
      { name: "Alex", color_index: 0 },
      { name: "Bea", color_index: 1 },
    ]);
  });

  it("re-dates a latest.log whose inferred date was wrong once its .gz appears", async () => {
    // mtime says Oct 6, but log4j later names the file Oct 5.
    source.put("latest.log", DAY1, "2026-10-06T11:05:02Z");
    await sync();
    source.rotate("2026-10-05-1.log.gz");
    await sync();
    expect(await count("log_files")).toBe(1);
    const [s] = await sql.query<{ start_ts: Date }>("select start_ts from smp.sessions");
    expect(s!.start_ts.toISOString()).toBe("2026-10-05T10:05:01.000Z");
  });

  it("records parse issues without failing", async () => {
    source.put("2026-10-05-1.log.gz", DAY1 + "%%% corrupted line %%%\n", "2026-10-05T11:06:00Z");
    const s = await sync();
    expect(s.newIssues).toBe(1);
    expect(await count("parse_issues")).toBe(1);
    expect(s.sessions).toBe(1);
  });

  it("--reparse rebuilds events from scratch without duplicates", async () => {
    source.put("2026-10-05-1.log.gz", DAY1, "2026-10-05T11:05:02Z");
    await sync();
    const events = await count("events");
    await sync({ reparse: true });
    expect(await count("events")).toBe(events);
    expect(await count("sessions")).toBe(1);
  });

  it("logs a sync run record", async () => {
    source.put("2026-10-05-1.log.gz", DAY1, "2026-10-05T11:05:02Z");
    await sync();
    const [run] = await sql.query<{ status: string; mode: string }>("select status, mode from smp.sync_runs");
    expect(run).toEqual({ status: "success", mode: "sync" });
  });
});
