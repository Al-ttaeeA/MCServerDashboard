import { describe, expect, it } from "vitest";
import type { LogEvent } from "../../parser/types";
import { buildSessions, type TimelineItem } from "../build-sessions";
import { resolvePlayers } from "../resolve-players";

const M = 60_000;
const T0 = Date.UTC(2026, 9, 5, 18, 0, 0); // 2026-10-05 18:00 UTC

/** Builds timeline items from `[minutesFromT0, event]`, resolving players by name. */
function timeline(...rows: ([number, LogEvent] | [number, "heartbeat"])[]): TimelineItem[] {
  return rows.map(([min, e], i) => {
    const ts = T0 + min * M;
    if (e === "heartbeat") return { kind: "heartbeat", ts };
    return { kind: "event", id: `e${i}`, ts, event: e, playerKey: "player" in e ? e.player : undefined };
  });
}
const join = (player: string): LogEvent => ({ type: "JOIN", player });
const leave = (player: string): LogEvent => ({ type: "LEAVE", player });
const start: LogEvent = { type: "SERVER_START", version: "26.3" };
const stop: LogEvent = { type: "SERVER_STOP" };
const pause: LogEvent = { type: "SERVER_PAUSE" };

const summary = (items: TimelineItem[]) =>
  buildSessions(items).sessions.map((s) => ({
    p: s.playerKey,
    start: (s.startTs - T0) / M,
    end: (s.endTs - T0) / M,
    reason: s.endReason,
  }));

describe("buildSessions", () => {
  it("normal session: join → leave", () => {
    expect(summary(timeline([0, start], [10, join("Alex")], [190, leave("Alex")]))).toEqual([
      { p: "Alex", start: 10, end: 190, reason: "leave" },
    ]);
  });

  it("multiple overlapping players", () => {
    expect(
      summary(timeline([0, join("Alex")], [30, join("Bea")], [60, leave("Alex")], [120, join("Alex")], [150, leave("Bea")], [180, leave("Alex")])),
    ).toEqual([
      { p: "Alex", start: 0, end: 60, reason: "leave" },
      { p: "Bea", start: 30, end: 150, reason: "leave" },
      { p: "Alex", start: 120, end: 180, reason: "leave" },
    ]);
  });

  it("server shutdown closes everyone online at the stop time", () => {
    expect(summary(timeline([0, start], [5, join("Alex")], [6, join("Bea")], [90, stop]))).toEqual([
      { p: "Alex", start: 5, end: 90, reason: "server_stop" },
      { p: "Bea", start: 6, end: 90, reason: "server_stop" },
    ]);
  });

  it("crash: a new start without stop closes sessions at the last observed line", () => {
    const items = timeline([0, start], [5, join("Alex")], [40, "heartbeat"], [300, start], [310, join("Alex")], [320, leave("Alex")]);
    expect(summary(items)).toEqual([
      { p: "Alex", start: 5, end: 40, reason: "crash" },
      { p: "Alex", start: 310, end: 320, reason: "leave" },
    ]);
    const runs = buildSessions(items).serverRuns;
    expect(runs.map((r) => [r.endReason, (r.endTs - T0) / M])).toEqual([
      ["crash", 40],
      ["open", 320],
    ]);
  });

  it("restart after clean stop doesn't duplicate or overlap sessions", () => {
    const items = timeline([0, start], [1, join("Alex")], [60, stop], [61, start], [62, join("Alex")], [90, leave("Alex")]);
    expect(summary(items)).toEqual([
      { p: "Alex", start: 1, end: 60, reason: "server_stop" },
      { p: "Alex", start: 62, end: 90, reason: "leave" },
    ]);
    expect(buildSessions(items).serverRuns.map((r) => r.endReason)).toEqual(["stop", "open"]);
  });

  it("duplicate join closes the earlier session (no overlaps)", () => {
    expect(summary(timeline([0, join("Alex")], [30, join("Alex")], [60, leave("Alex")]))).toEqual([
      { p: "Alex", start: 0, end: 30, reason: "rejoin" },
      { p: "Alex", start: 30, end: 60, reason: "leave" },
    ]);
  });

  it("duplicate leave / leave without join is ignored", () => {
    expect(summary(timeline([0, leave("Bea")], [5, join("Alex")], [10, leave("Alex")], [10, leave("Alex")]))).toEqual([
      { p: "Alex", start: 5, end: 10, reason: "leave" },
    ]);
  });

  it("'server empty' pause closes a session whose leave was missed", () => {
    expect(summary(timeline([0, join("Alex")], [120, pause]))).toEqual([
      { p: "Alex", start: 0, end: 119, reason: "inferred_empty" },
    ]);
  });

  it("player still online at the end of the logs → open session", () => {
    expect(summary(timeline([0, join("Alex")], [45, "heartbeat"]))).toEqual([{ p: "Alex", start: 0, end: 45, reason: "open" }]);
  });

  it("sessions spanning midnight across two files stay one session", () => {
    // join at 23:30 in one file, leave at 00:30 in the next day's file
    expect(summary(timeline([330, join("Alex")], [359, "heartbeat"], [361, "heartbeat"], [390, leave("Alex")]))).toEqual([
      { p: "Alex", start: 330, end: 390, reason: "leave" },
    ]);
  });

  it("captures the disconnect reason", () => {
    const items = timeline([0, join("Alex")], [10, { type: "DISCONNECT", player: "Alex", reason: "Timed out" }], [10, leave("Alex")]);
    expect(buildSessions(items).sessions[0]!.disconnectReason).toBe("Timed out");
  });

  it("lines outside a run (failed start, after a stop) don't create phantom runs", () => {
    const items = timeline([0, "heartbeat"], [5, start], [6, join("Alex")], [60, stop], [60, "heartbeat"], [61, start], [70, "heartbeat"]);
    const runs = buildSessions(items).serverRuns;
    expect(runs.map((r) => [r.endReason, (r.startTs - T0) / M, (r.endTs - T0) / M])).toEqual([
      ["stop", 5, 60],
      ["open", 61, 70],
    ]);
  });

  it("logs that start mid-run create an implicit run", () => {
    const { serverRuns } = buildSessions(timeline([0, join("Alex")], [10, leave("Alex")]));
    expect(serverRuns).toHaveLength(1);
    expect(serverRuns[0]!.startEventId).toBeNull();
  });

  it("is deterministic and empty input is fine", () => {
    const items = timeline([0, join("Alex")], [10, leave("Alex")]);
    expect(buildSessions(items)).toEqual(buildSessions(items));
    expect(buildSessions([])).toEqual({ sessions: [], serverRuns: [] });
  });
});

describe("resolvePlayers", () => {
  const U1 = "11111111-2222-4333-8444-555555555555";
  it("keys players by UUID and follows renames", () => {
    const { keys, players } = resolvePlayers([
      { ts: 1, event: { type: "PLAYER_UUID", player: "OldName", uuid: U1 } },
      { ts: 2, event: { type: "JOIN", player: "OldName" } },
      { ts: 3, event: { type: "PLAYER_UUID", player: "NewName", uuid: U1 } },
      { ts: 4, event: { type: "JOIN", player: "NewName", formerName: "OldName" } },
      { ts: 5, event: { type: "SERVER_STOP" } },
    ]);
    expect(keys).toEqual([U1, U1, U1, U1, null]);
    expect(players.get(U1)).toMatchObject({ name: "NewName", names: ["OldName", "NewName"], firstSeenTs: 2, lastSeenTs: 4 });
  });

  it("falls back to a provisional name key without a UUID", () => {
    const { keys } = resolvePlayers([{ ts: 1, event: { type: "JOIN", player: "Ghost" } }]);
    expect(keys).toEqual(["name:ghost"]);
  });

  it("uses known UUIDs from previous imports", () => {
    const { keys } = resolvePlayers([{ ts: 1, event: { type: "LEAVE", player: "Alex" } }], new Map([["Alex", U1]]));
    expect(keys).toEqual([U1]);
  });

  it("doesn't create players for UUID-only lines (rejected by whitelist)", () => {
    const { players } = resolvePlayers([{ ts: 1, event: { type: "PLAYER_UUID", player: "Rando", uuid: U1 } }]);
    expect(players.size).toBe(0);
  });
});
