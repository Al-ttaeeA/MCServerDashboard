import { describe, expect, it } from "vitest";
import { classifyLogFile, compareLogFiles, inferLatestLogDate, type LogFileInfo } from "../log-files";
import { zonedTimeToUtc } from "../../time/zoned";

describe("classifyLogFile", () => {
  it("recognizes rotated and latest logs", () => {
    expect(classifyLogFile("2026-10-03-2.log.gz")).toEqual({
      kind: "rotated",
      name: "2026-10-03-2.log.gz",
      date: "2026-10-03",
      seq: 2,
      gzip: true,
    });
    expect(classifyLogFile("2026-10-03-1.log")).toMatchObject({ gzip: false });
    expect(classifyLogFile("latest.log")).toEqual({ kind: "latest", name: "latest.log" });
  });

  it.each(["debug.log", "2026-13-40-1.log.gz", "notes.txt", "2026-10-03.log.gz"])("rejects %s", (name) => {
    expect(classifyLogFile(name)).toBeNull();
  });
});

describe("compareLogFiles", () => {
  it("orders by date, then sequence, with latest.log last", () => {
    const names = ["latest.log", "2026-10-04-1.log.gz", "2026-10-03-2.log.gz", "2026-10-03-10.log.gz", "2026-10-03-1.log.gz"];
    const sorted = names
      .map((n) => classifyLogFile(n)!)
      .sort(compareLogFiles)
      .map((f: LogFileInfo) => f.name);
    expect(sorted).toEqual([
      "2026-10-03-1.log.gz",
      "2026-10-03-2.log.gz",
      "2026-10-03-10.log.gz",
      "2026-10-04-1.log.gz",
      "latest.log",
    ]);
  });
});

describe("inferLatestLogDate", () => {
  const utc = (iso: string) => Date.parse(iso);

  it("uses the mtime's date when the last line is before the mtime", () => {
    expect(inferLatestLogDate(utc("2026-10-05T06:35:56Z"), 6 * 3600 + 35 * 60 + 56, "UTC")).toBe("2026-10-05");
  });

  it("steps back a day when mtime is just past midnight", () => {
    expect(inferLatestLogDate(utc("2026-10-06T00:00:03Z"), 23 * 3600 + 59 * 60 + 58, "UTC")).toBe("2026-10-05");
  });

  it("respects the server timezone", () => {
    // 02:00 UTC on Oct 6 is still Oct 5 in New York.
    expect(inferLatestLogDate(utc("2026-10-06T02:00:00Z"), 21 * 3600, "America/New_York")).toBe("2026-10-05");
  });

  it("handles an empty file", () => {
    expect(inferLatestLogDate(utc("2026-10-05T12:00:00Z"), null, "UTC")).toBe("2026-10-05");
  });
});

describe("zonedTimeToUtc", () => {
  const d = { year: 2026, month: 10, day: 5 };

  it("is the identity for UTC", () => {
    expect(new Date(zonedTimeToUtc(d, 3600, "UTC")).toISOString()).toBe("2026-10-05T01:00:00.000Z");
  });

  it("converts EDT wall-clock to UTC", () => {
    expect(new Date(zonedTimeToUtc(d, 18 * 3600, "America/New_York")).toISOString()).toBe("2026-10-05T22:00:00.000Z");
  });

  it("applies day offsets", () => {
    expect(new Date(zonedTimeToUtc(d, 60, "UTC", 1)).toISOString()).toBe("2026-10-06T00:01:00.000Z");
  });

  it("handles DST transitions (Nov 1 2026, New York falls back)", () => {
    const nov1 = { year: 2026, month: 11, day: 1 };
    // 00:30 is still EDT (-4), 03:00 is EST (-5).
    expect(new Date(zonedTimeToUtc(nov1, 1800, "America/New_York")).toISOString()).toBe("2026-11-01T04:30:00.000Z");
    expect(new Date(zonedTimeToUtc(nov1, 3 * 3600, "America/New_York")).toISOString()).toBe("2026-11-01T08:00:00.000Z");
  });
});
