import { describe, expect, it } from "vitest";
import { NbtError, readNbt } from "../nbt";
import {
  completedAt,
  levelNameFromProperties,
  parseAdvancementTime,
  parseAdvancementsFile,
  parsePlayerData,
  parseStatsFile,
  uuidFromWorldFile,
  worldLayouts,
} from "../world-files";

/** Tiny NBT writer for building fixtures. */
class NbtWriter {
  private parts: number[] = [];
  private u8(v: number) {
    this.parts.push(v & 0xff);
  }
  private u16(v: number) {
    this.u8(v >> 8);
    this.u8(v);
  }
  private i32(v: number) {
    this.u8(v >>> 24);
    this.u8(v >>> 16);
    this.u8(v >>> 8);
    this.u8(v);
  }
  private name(s: string) {
    const b = new TextEncoder().encode(s);
    this.u16(b.length);
    b.forEach((x) => this.u8(x));
  }
  begin() {
    this.u8(10);
    this.name("");
    return this;
  }
  int(name: string, v: number) {
    this.u8(3);
    this.name(name);
    this.i32(v);
    return this;
  }
  byte(name: string, v: number) {
    this.u8(1);
    this.name(name);
    this.u8(v);
    return this;
  }
  string(name: string, v: string) {
    this.u8(8);
    this.name(name);
    this.name(v);
    return this;
  }
  doubleList(name: string, values: number[]) {
    this.u8(9);
    this.name(name);
    this.u8(6);
    this.i32(values.length);
    for (const v of values) {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, v);
      b.forEach((x) => this.u8(x));
    }
    return this;
  }
  intArray(name: string, values: number[]) {
    this.u8(11);
    this.name(name);
    this.i32(values.length);
    values.forEach((v) => this.i32(v));
    return this;
  }
  compound(name: string, fn: (w: NbtWriter) => void) {
    this.u8(10);
    this.name(name);
    fn(this);
    this.u8(0);
    return this;
  }
  end() {
    this.u8(0);
    return new Uint8Array(this.parts);
  }
}

describe("readNbt", () => {
  const bytes = new NbtWriter()
    .begin()
    .int("XpLevel", 24)
    .int("XpTotal", 7371)
    .byte("seenCredits", 1)
    .string("Dimension", "minecraft:overworld")
    .doubleList("Pos", [12.5, 64, -3.25])
    .intArray("UUID", [1, 2, 3, 4])
    .compound("abilities", (w) => w.byte("flying", 0))
    .end();

  it("reads scalars, strings, lists, arrays and nested compounds", () => {
    const root = readNbt(bytes);
    expect(root.XpLevel).toBe(24);
    expect(root.Dimension).toBe("minecraft:overworld");
    expect(root.Pos).toMatchObject({ kind: "list", items: [12.5, 64, -3.25] });
    expect(root.UUID).toEqual({ kind: "array", type: "int", length: 4 });
    expect(root.abilities).toEqual({ flying: 0 });
  });

  it("extracts only the safe profile fields", () => {
    const profile = parsePlayerData(bytes);
    expect(profile).toEqual({ xpLevel: 24, xpTotal: 7371, seenCredits: true });
    expect(JSON.stringify(profile)).not.toContain("12.5"); // no position
  });

  it("rejects truncated or invalid data", () => {
    expect(() => readNbt(bytes.subarray(0, 20))).toThrow(NbtError);
    expect(() => readNbt(new Uint8Array([3, 0, 0]))).toThrow(NbtError);
  });

  it("treats missing fields as unknown", () => {
    expect(parsePlayerData(new NbtWriter().begin().end())).toEqual({ xpLevel: null, xpTotal: null, seenCredits: false });
  });
});

describe("stats files", () => {
  it("strips the vanilla namespace and ignores non-numbers", () => {
    const parsed = parseStatsFile(
      JSON.stringify({
        stats: {
          "minecraft:mined": { "minecraft:stone": 12, "minecraft:diamond_ore": 3 },
          "minecraft:custom": { "minecraft:play_time": 72000, "minecraft:bogus": "x" },
          "mymod:stuff": { "mymod:thing": 1 },
        },
        DataVersion: 5023,
      }),
    );
    expect(parsed).toEqual({
      dataVersion: 5023,
      stats: { mined: { stone: 12, diamond_ore: 3 }, custom: { play_time: 72000 }, "mymod:stuff": { "mymod:thing": 1 } },
    });
  });
});

describe("advancement files", () => {
  const file = JSON.stringify({
    "minecraft:story/mine_diamond": { criteria: { diamond: "2026-10-03 22:37:46 +0000" }, done: true },
    "minecraft:adventure/adventuring_time": {
      criteria: { "minecraft:forest": "2026-10-03 03:48:56 +0000", "minecraft:taiga": "2026-10-04 01:00:00 -0400" },
      done: false,
    },
    "minecraft:recipes/misc/stick": { criteria: { has_planks: "2026-10-03 03:40:00 +0000" }, done: true },
    DataVersion: 5023,
  });

  it("drops recipe unlocks and parses criteria timestamps", () => {
    const { advancements, dataVersion } = parseAdvancementsFile(file);
    expect(dataVersion).toBe(5023);
    expect(advancements.map((a) => a.id)).toEqual(["adventure/adventuring_time", "story/mine_diamond"]);
    expect(advancements[0]!.criteria).toEqual({ forest: "2026-10-03T03:48:56.000Z", taiga: "2026-10-04T05:00:00.000Z" });
  });

  it("completion time is the last criterion, only when done", () => {
    const [inProgress, diamond] = parseAdvancementsFile(file).advancements;
    expect(completedAt(diamond!)).toBe("2026-10-03T22:37:46.000Z");
    expect(completedAt(inProgress!)).toBeNull();
    expect(parseAdvancementTime("nonsense")).toBeNull();
  });
});

describe("layout helpers", () => {
  it("reads level-name from server.properties", () => {
    expect(levelNameFromProperties("#comment\nmotd=hi\nlevel-name=smp world\n")).toBe("smp world");
    expect(levelNameFromProperties("motd=hi")).toBe("world");
  });

  it("offers the 26.1+ layout before the legacy one", () => {
    const [modern, legacy] = worldLayouts("world/");
    expect(modern!.dirs).toEqual({ stats: "world/players/stats", advancements: "world/players/advancements", playerdata: "world/players/data" });
    expect(legacy!.dirs.playerdata).toBe("world/playerdata");
  });

  it("only accepts <uuid>.json / <uuid>.dat", () => {
    expect(uuidFromWorldFile("138D8A17-D704-4917-975F-BDF0F04AD99B.dat")).toBe("138d8a17-d704-4917-975f-bdf0f04ad99b");
    expect(uuidFromWorldFile("138d8a17-d704-4917-975f-bdf0f04ad99b.dat_old")).toBeNull();
    expect(uuidFromWorldFile("level.dat")).toBeNull();
  });
});
