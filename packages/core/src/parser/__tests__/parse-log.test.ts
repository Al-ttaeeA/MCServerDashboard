import { describe, expect, it } from "vitest";
import { parseLog, redactIps } from "../parse-log";
import { tokenizeLine } from "../tokenize";
import type { LogEvent } from "../types";

/** Builds a log text from `[time, thread, message]` rows (always newline-terminated). */
function log(...rows: [string, string, string][]): string {
  return rows.map(([t, thread, msg]) => `[${t}] [${thread}]: ${msg}`).join("\n") + "\n";
}
const S = "Server thread/INFO";
const AUTH = "User Authenticator #1/INFO";
const UUID_A = "11111111-2222-4333-8444-555555555555";
const UUID_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const events = (text: string, opts?: Parameters<typeof parseLog>[1]) =>
  parseLog(text, opts).events.map((e) => e.event);

describe("tokenizeLine", () => {
  it("splits time, thread, level and message", () => {
    expect(tokenizeLine("[03:33:11] [User Authenticator #1/INFO]: UUID of player A is x")).toEqual({
      secondOfDay: 3 * 3600 + 33 * 60 + 11,
      thread: "User Authenticator #1",
      level: "INFO",
      message: "UUID of player A is x",
    });
  });

  it("accepts the alternative `[HH:MM:SS LEVEL]:` layout", () => {
    expect(tokenizeLine("[12:00:00 INFO]: Steve joined the game")).toMatchObject({
      level: "INFO",
      message: "Steve joined the game",
    });
  });

  it.each([
    "",
    "no header at all",
    "[25:00:00] [Server thread/INFO]: impossible hour",
    "[12:60:00] [Server thread/INFO]: impossible minute",
    "[12:00] [Server thread/INFO]: short clock",
    "[12:00:00] [Server thread/INFO] missing colon",
  ])("rejects malformed line %j", (line) => {
    expect(tokenizeLine(line)).toBeNull();
  });
});

describe("parseLog — player lifecycle", () => {
  it("parses uuid, login (without IP), join, disconnect and leave", () => {
    const text = log(
      ["03:33:11", AUTH, `UUID of player Alex_01 is ${UUID_A}`],
      ["03:33:13", S, "Alex_01[/203.0.113.7:65288] logged in with entity id 25 at (13.5, 97.0, -53.5)"],
      ["03:33:13", S, "System chat: Alex_01 joined the game"],
      ["04:10:00", S, "Alex_01 lost connection: Disconnected"],
      ["04:10:00", S, "System chat: Alex_01 left the game"],
    );
    expect(events(text)).toEqual<LogEvent[]>([
      { type: "PLAYER_UUID", player: "Alex_01", uuid: UUID_A },
      { type: "PLAYER_LOGIN", player: "Alex_01", x: 13.5, y: 97, z: -53.5 },
      { type: "JOIN", player: "Alex_01" },
      { type: "DISCONNECT", player: "Alex_01", reason: "Disconnected" },
      { type: "LEAVE", player: "Alex_01" },
    ]);
    expect(JSON.stringify(parseLog(text))).not.toContain("203.0.113.7");
  });

  it("works without the 26.x `System chat:` prefix (older versions)", () => {
    const text = log(["10:00:00", S, "Alex_01 joined the game"], ["11:00:00", S, "Alex_01 left the game"]);
    expect(events(text).map((e) => e.type)).toEqual(["JOIN", "LEAVE"]);
  });

  it("handles multiple players interleaved", () => {
    const text = log(
      ["10:00:00", AUTH, `UUID of player Alex_01 is ${UUID_A}`],
      ["10:00:01", S, "System chat: Alex_01 joined the game"],
      ["10:05:00", AUTH, `UUID of player Bea is ${UUID_B}`],
      ["10:05:01", S, "System chat: Bea joined the game"],
      ["11:00:00", S, "System chat: Alex_01 left the game"],
      ["12:00:00", S, "System chat: Bea left the game"],
    );
    expect(events(text).filter((e) => e.type === "JOIN" || e.type === "LEAVE")).toEqual([
      { type: "JOIN", player: "Alex_01" },
      { type: "JOIN", player: "Bea" },
      { type: "LEAVE", player: "Alex_01" },
      { type: "LEAVE", player: "Bea" },
    ]);
  });

  it("captures renames from `(formerly known as …)`", () => {
    expect(events(log(["10:00:00", S, "System chat: NewName (formerly known as OldName) joined the game"]))).toEqual([
      { type: "JOIN", player: "NewName", formerName: "OldName" },
    ]);
  });

  it("ignores pre-login disconnects (no session was ever started)", () => {
    const r = parseLog(
      log(
        ["10:00:00", S, "stranger (/203.0.113.9:1234) lost connection: Disconnected"],
        ["10:00:01", S, "Disconnecting stranger (/203.0.113.9:1234): You are not white-listed on this server!"],
      ),
    );
    expect(r.events).toEqual([]);
    expect(r.issues).toEqual([]);
    expect(r.ignoredLines).toBe(2);
  });

  it("keeps timed-out disconnect reasons", () => {
    expect(events(log(["10:00:00", S, "Bea lost connection: Timed out"]))).toEqual([
      { type: "DISCONNECT", player: "Bea", reason: "Timed out" },
    ]);
  });
});

describe("parseLog — server lifecycle", () => {
  it("recognizes start, ready, pause and stop", () => {
    const text = log(
      ["03:27:09", S, "Starting minecraft server version 26.3"],
      ["03:27:12", S, 'Done (2.591s)! For help, type "help"'],
      ["03:28:12", S, "Server empty for 60 seconds, pausing"],
      ["05:00:00", S, "Stopping server"],
    );
    expect(events(text)).toEqual<LogEvent[]>([
      { type: "SERVER_START", version: "26.3" },
      { type: "SERVER_READY", startupSeconds: 2.591 },
      { type: "SERVER_PAUSE" },
      { type: "SERVER_STOP" },
    ]);
  });
});

describe("parseLog — deaths, advancements, chat", () => {
  const known = { knownPlayers: ["Alex_01", "Bea"] };

  it.each<[string, Partial<Extract<LogEvent, { type: "DEATH" }>>]>([
    ["Alex_01 was slain by Zombie", { cause: "attack.mob", killer: "Zombie" }],
    ["Alex_01 was blown up by Creeper", { cause: "attack.explosion.player", killer: "Creeper" }],
    ["Alex_01 drowned", { cause: "attack.drown" }],
    ["Alex_01 fell from a high place", { cause: "fell.accident.generic" }],
    ["Alex_01 burned to death", { cause: "attack.onFire" }],
    ["Alex_01 was killed by Witch using magic", { cause: "attack.indirectMagic", killer: "Witch" }],
    ["Alex_01 was doomed to fall by Skeleton", { cause: "fell.assist", killer: "Skeleton" }],
    ["Alex_01 was slain by Bea using [Diamond Sword]", { cause: "attack.mob.item", killer: "Bea", weapon: "Diamond Sword" }],
    ["Alex_01 was shot by Skeleton", { cause: "attack.arrow", killer: "Skeleton" }],
    ["Alex_01 tried to swim in lava to escape Zombie", { cause: "attack.lava.player", killer: "Zombie" }],
  ])("death: %s", (message, expected) => {
    const [e] = events(log(["10:00:00", S, `System chat: ${message}`]), known);
    expect(e).toMatchObject({ type: "DEATH", player: "Alex_01", message, ...expected });
  });

  it("does not treat system messages about unknown names as deaths", () => {
    const r = parseLog(log(["10:00:00", S, "System chat: Whitelist is now turned off"]), known);
    expect(r.events).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it("learns players from UUID lines before matching deaths", () => {
    const text = log(
      ["10:00:00", AUTH, `UUID of player Cy is ${UUID_B}`],
      ["10:30:00", S, "System chat: Cy drowned"],
    );
    expect(events(text).map((e) => e.type)).toEqual(["PLAYER_UUID", "DEATH"]);
  });

  it.each([
    ["has made the advancement [Stone Age]", "task", "Stone Age"],
    ["has completed the challenge [Return to Sender]", "challenge", "Return to Sender"],
    ["has reached the goal [Sky's the Limit]", "goal", "Sky's the Limit"],
    ["has made the advancement [Minecraft: Trial(s) Edition]", "task", "Minecraft: Trial(s) Edition"],
  ])("advancement: %s", (suffix, kind, advancement) => {
    expect(events(log(["10:00:00", S, `System chat: Bea ${suffix}`]))).toEqual([
      { type: "ADVANCEMENT", player: "Bea", advancement, kind },
    ]);
  });

  it("records chat features but never its content", () => {
    const r = parseLog(log(["10:00:00", S, "<Bea> my secret base is at 100 64 -200"], ["10:00:01", S, "[Not Secure] <Alex_01> HELLO EVERYONE"]));
    const [a, b] = r.events.map((e) => e.event) as Extract<LogEvent, { type: "CHAT" }>[];
    expect(a).toMatchObject({ type: "CHAT", player: "Bea", length: 32, capsShare: 0 });
    expect(b).toMatchObject({ type: "CHAT", player: "Alex_01", length: 14, capsShare: 1 });
    expect(a!.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("gives repeated messages the same hash regardless of case and spacing", () => {
    const evs = events(log(["10:00:00", S, "<Bea> gg"], ["10:00:05", S, "<Bea>  GG "], ["10:00:09", S, "<Bea> lol"])) as Extract<LogEvent, { type: "CHAT" }>[];
    expect(evs[0]!.hash).toBe(evs[1]!.hash);
    expect(evs[0]!.hash).not.toBe(evs[2]!.hash);
    expect(evs[0]!.capsShare).toBeNull(); // too few letters to judge
  });

  it("does not mistake quoted death text in chat for a death", () => {
    expect(events(log(["10:00:00", S, "<Bea> Alex_01 tried to swim in lava."]), known).map((e) => e.type)).toEqual(["CHAT"]);
  });
});

describe("parseLog — robustness", () => {
  it("skips stack traces as continuation lines, not issues", () => {
    const text =
      log(["10:00:00", "Netty Epoll IO #0/WARN", "Failed to deliver packet"]) +
      "io.netty.channel.StacklessClosedChannelException\n\tat io.netty.channel.AbstractChannel.close(ChannelPromise)(Unknown Source)\n";
    const r = parseLog(text);
    expect(r.issues).toEqual([]);
    expect(r.continuationLines).toBe(2);
  });

  it("treats header-less lines after an entry as part of a multi-line message", () => {
    const text =
      log(["06:37:30", S, "Disconnecting OvlaxO (/203.0.113.4:5000): You are banned from this server."]) +
      "Reason: Banned by an operator.\n" +
      log(["06:37:31", S, "System chat: Bea joined the game"]);
    const r = parseLog(text);
    expect(r.issues).toEqual([]);
    expect(r.continuationLines).toBe(1);
    expect(r.events.map((e) => e.event.type)).toEqual(["JOIN"]);
  });

  it("still flags broken headers and control characters mid-file", () => {
    const text = log(["10:00:00", S, "Bea joined the game"]) + "[10:0\n" + "bad\u0001bytes\n";
    expect(parseLog(text).issues.map((i) => i.reason)).toEqual(["malformed_line", "malformed_line"]);
  });

  it("ignores admin command output about players", () => {
    const r = parseLog(log(["06:35:51", S, "System chat: OvlaxO has the following entity data: 20.0f"]), { knownPlayers: ["OvlaxO"] });
    expect(r.issues).toEqual([]);
    expect(r.ignoredLines).toBe(1);
  });

  it("reports malformed lines and keeps going", () => {
    const text = "garbage ### line\n" + log(["10:00:00", S, "Bea joined the game"]);
    const r = parseLog(text);
    expect(r.issues).toEqual([{ lineNo: 1, reason: "malformed_line", raw: "garbage ### line" }]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.lineNo).toBe(2);
  });

  it("flags unknown broadcast messages about known players (likely new death types)", () => {
    const r = parseLog(log(["10:00:00", S, "System chat: Bea was speared by a mysterious new mob"]), {
      knownPlayers: ["Bea"],
    });
    expect(r.issues.map((i) => i.reason)).toEqual(["unrecognized_player_message"]);
  });

  it("ignores ordinary noise without flagging it", () => {
    const r = parseLog(
      log(
        ["10:00:00", S, "Player Bea standing on air - force-sending blocks below"],
        ["10:00:01", "Server thread/WARN", "Bea moved too quickly! 1,2,3"],
        ["10:00:02", S, "Saving chunks for level 'ServerLevel[world]'/minecraft:overworld"],
      ),
      { knownPlayers: ["Bea"] },
    );
    expect(r.issues).toEqual([]);
    expect(r.ignoredLines).toBe(3);
  });

  it("drops an incomplete trailing line (file mid-write)", () => {
    const text = log(["10:00:00", S, "Bea joined the game"]) + "[10:00:05] [Server thread/INFO]: Bea le";
    const r = parseLog(text);
    expect(r.totalLines).toBe(1);
    expect(parseLog(text, { dropIncompleteLastLine: false }).totalLines).toBe(2);
  });

  it("handles CRLF line endings", () => {
    expect(events("[10:00:00] [Server thread/INFO]: Bea joined the game\r\n")).toEqual([{ type: "JOIN", player: "Bea" }]);
  });

  it("detects an unexpected midnight rollover inside a file", () => {
    const r = parseLog(log(["23:59:00", S, "Bea joined the game"], ["00:01:00", S, "Bea left the game"]));
    expect(r.events.map((e) => e.dayOffset)).toEqual([0, 1]);
    expect(r.issues.map((i) => i.reason)).toEqual(["time_went_backwards"]);
  });

  it("tolerates small backwards clock corrections", () => {
    const r = parseLog(log(["10:00:05", S, "Bea joined the game"], ["10:00:01", S, "Bea left the game"]));
    expect(r.events.map((e) => e.dayOffset)).toEqual([0, 0]);
    expect(r.issues).toEqual([]);
  });

  it("is deterministic (same input → identical output)", () => {
    const text = log(["10:00:00", S, "Bea joined the game"], ["11:00:00", S, "Bea left the game"]);
    expect(parseLog(text)).toEqual(parseLog(text));
  });

  it("redacts IPv4 and IPv6 addresses", () => {
    expect(redactIps("x (/203.0.113.9:1234) y")).toBe("x (/<ip>) y");
    expect(redactIps("x /2001:db8:0:0:1:0:0:1 y")).toBe("x /<ip> y");
    expect(redactIps("[10:00:00] keeps clock times")).toBe("[10:00:00] keeps clock times");
  });
});
