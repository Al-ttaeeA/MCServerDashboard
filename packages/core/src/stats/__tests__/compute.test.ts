import { describe, expect, it } from "vitest";
import type { LogEvent } from "../../parser/types";
import { forEachLocalHour } from "../buckets";
import { causeLabel, computeStats, computeStreaks, peakConcurrent, type StatsSession } from "../compute";
import { pickHighlights } from "../registry";

const utc = (s: string) => Date.parse(s);
const sess = (playerKey: string, start: string, end: string, endReason: StatsSession["endReason"] = "leave"): StatsSession => ({
  playerKey,
  startTs: utc(start),
  endTs: utc(end),
  endReason,
});

describe("forEachLocalHour", () => {
  it("splits a session across local midnight into the correct dates (EDT)", () => {
    // 03:30–05:15 UTC on Oct 6 = 23:30–01:15 EDT, spanning Oct 5 → Oct 6 locally.
    const byDate = new Map<string, number>();
    forEachLocalHour(utc("2026-10-06T03:30:00Z"), utc("2026-10-06T05:15:00Z"), "America/New_York", (s) =>
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.seconds),
    );
    expect(Object.fromEntries(byDate)).toEqual({ "2026-10-05": 1800, "2026-10-06": 4500 });
  });

  it("assigns hours and weekdays", () => {
    const slices: { hour: number; weekday: number; seconds: number }[] = [];
    forEachLocalHour(utc("2026-10-05T10:45:00Z"), utc("2026-10-05T12:00:00Z"), "UTC", ({ hour, weekday, seconds }) =>
      slices.push({ hour, weekday, seconds }),
    );
    // 2026-10-05 is a Monday.
    expect(slices).toEqual([
      { hour: 10, weekday: 0, seconds: 900 },
      { hour: 11, weekday: 0, seconds: 3600 },
    ]);
  });
});

describe("computeStreaks", () => {
  it("finds longest and current streaks", () => {
    const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-07", "2026-10-08"];
    expect(computeStreaks(days, "2026-10-09")).toEqual({ longest: 3, current: 2 });
    expect(computeStreaks(days, "2026-10-12")).toEqual({ longest: 3, current: 0 });
    expect(computeStreaks([], "2026-10-12")).toEqual({ longest: 0, current: 0 });
  });
});

describe("peakConcurrent", () => {
  it("counts overlapping sessions; touching sessions don't overlap", () => {
    expect(
      peakConcurrent([
        sess("a", "2026-10-05T10:00:00Z", "2026-10-05T12:00:00Z"),
        sess("b", "2026-10-05T11:00:00Z", "2026-10-05T13:00:00Z"),
        sess("c", "2026-10-05T12:00:00Z", "2026-10-05T14:00:00Z"),
      ]),
    ).toEqual({ count: 2, at: "2026-10-05T11:00:00.000Z" });
    expect(peakConcurrent([])).toBeNull();
  });
});

describe("causeLabel", () => {
  it("strips the player and weapon", () => {
    const d = (message: string, weapon?: string): Extract<LogEvent, { type: "DEATH" }> => ({
      type: "DEATH",
      player: "Alex",
      message,
      cause: "x",
      ...(weapon ? { weapon } : {}),
    });
    expect(causeLabel(d("Alex was slain by Zombie"))).toBe("Slain by Zombie");
    expect(causeLabel(d("Alex was slain by Bea using [Iron Sword]", "Iron Sword"))).toBe("Slain by Bea");
    expect(causeLabel(d("Alex fell from a high place"))).toBe("Fell from a high place");
  });
});

describe("computeStats", () => {
  const now = utc("2026-10-06T12:00:00Z");
  const sessions = [
    sess("alex", "2026-10-05T10:00:00Z", "2026-10-05T12:00:00Z"),
    sess("alex", "2026-10-06T10:00:00Z", "2026-10-06T10:30:00Z", "crash"),
    sess("bea", "2026-10-05T11:00:00Z", "2026-10-05T11:45:00Z"),
  ];
  const events = [
    { playerKey: "alex", ts: utc("2026-10-05T10:10:00Z"), event: { type: "DEATH", player: "Alex", message: "Alex was slain by Zombie", cause: "attack.mob", killer: "Zombie" } },
    { playerKey: "alex", ts: utc("2026-10-05T10:20:00Z"), event: { type: "DEATH", player: "Alex", message: "Alex drowned", cause: "attack.drown" } },
    { playerKey: "alex", ts: utc("2026-10-05T10:30:00Z"), event: { type: "ADVANCEMENT", player: "Alex", advancement: "Stone Age", kind: "task" } },
    { playerKey: "alex", ts: utc("2026-10-05T10:31:00Z"), event: { type: "ADVANCEMENT", player: "Alex", advancement: "Stone Age", kind: "task" } },
    { playerKey: "bea", ts: utc("2026-10-05T11:10:00Z"), event: { type: "CHAT", player: "Bea" } },
    { playerKey: null, ts: utc("2026-10-05T09:00:00Z"), event: { type: "SERVER_START", version: "26.3" } },
  ] as const;

  const out = computeStats({
    playerKeys: ["alex", "bea", "ghost"],
    sessions,
    events: events as never,
    serverRuns: [],
    timeZone: "UTC",
    now,
  });
  const alex = out.players.get("alex")!;
  const bea = out.players.get("bea")!;

  it("computes playtime aggregates", () => {
    expect(alex.playtimeSeconds).toBe(9000);
    expect(alex.sessionCount).toBe(2);
    expect(alex.averageSessionSeconds).toBe(4500);
    expect(alex.medianSessionSeconds).toBe(4500);
    expect(alex.longestSession).toMatchObject({ seconds: 7200, start: "2026-10-05T10:00:00.000Z" });
    expect(alex.activeDays).toBe(2);
    expect(alex.currentStreakDays).toBe(2);
    expect(alex.estimatedEndShare).toBe(0.5);
    expect(alex.daily).toEqual([
      { date: "2026-10-05", seconds: 7200 },
      { date: "2026-10-06", seconds: 1800 },
    ]);
    expect(alex.hourly[10]).toBe(3600 + 1800);
    expect(alex.favoriteHour).toBe(10);
  });

  it("summarizes deaths, deduplicates advancements, counts chat", () => {
    expect(alex.deaths.total).toBe(2);
    expect(alex.deaths.topKiller).toEqual({ name: "Zombie", count: 1 });
    expect(alex.deaths.byCategory.map((c) => c.category).sort()).toEqual(["drowning", "mob"]);
    expect(alex.deaths.recent[0]!.message).toBe("Alex drowned");
    expect(alex.advancements.total).toBe(1);
    expect(alex.advancements.list[0]!.earnedAt).toBe("2026-10-05T10:30:00.000Z");
    expect(bea.chat.messages).toBe(1);
    expect(bea.chat.perHour).toBeNull(); // under an hour of playtime
  });

  it("finds companions from overlapping sessions", () => {
    expect(alex.topCompanion).toEqual({ playerKey: "bea", seconds: 2700 });
    expect(bea.topCompanion).toEqual({ playerKey: "alex", seconds: 2700 });
  });

  it("handles a player with no data", () => {
    const ghost = out.players.get("ghost")!;
    expect(ghost).toMatchObject({ playtimeSeconds: 0, sessionCount: 0, longestSession: null, favoriteHour: null, firstSeen: null });
  });

  it("computes server totals", () => {
    expect(out.server).toMatchObject({
      playerCount: 2,
      sessionCount: 3,
      totalPlaytimeSeconds: 9000 + 2700,
      peakConcurrent: { count: 2 },
      busiestDay: { date: "2026-10-05" },
      deaths: 2,
      chatMessages: 1,
      versions: [{ version: "26.3" }],
    });
  });

  it("placeholder highlights return three stats", () => {
    expect(pickHighlights("alex", out.players).map((h) => h.statId)).toEqual(["longest_session", "deaths", "advancements"]);
    expect(pickHighlights("nobody", out.players)).toEqual([]);
  });
});
