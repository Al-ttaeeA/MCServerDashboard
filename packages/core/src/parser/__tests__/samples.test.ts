/**
 * Smoke test against real server logs in /samples (gitignored, so this only
 * runs on a machine that has them). Asserts the parser understands every
 * meaningful line, i.e. no parse issues.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { classifyLogFile, compareLogFiles } from "../../logs/log-files";
import { parseLog } from "../parse-log";

const dir = join(__dirname, "../../../../../samples");
const files = existsSync(dir)
  ? readdirSync(dir)
      .map(classifyLogFile)
      .filter((f) => f !== null)
      .sort(compareLogFiles)
  : [];

describe.skipIf(files.length === 0)("real sample logs", () => {
  it("parse without issues and produce consistent join/leave counts", () => {
    const known = new Set<string>();
    let joins = 0;
    let leaves = 0;
    for (const f of files) {
      const buf = readFileSync(join(dir, f.name));
      const text = (f.kind === "rotated" && f.gzip ? gunzipSync(buf) : buf).toString("utf8");
      const r = parseLog(text, { knownPlayers: known });
      expect(r.issues, f.name).toEqual([]);
      for (const { event } of r.events) {
        if (event.type === "PLAYER_UUID") known.add(event.player);
        if (event.type === "JOIN") joins++;
        if (event.type === "LEAVE") leaves++;
      }
    }
    expect(joins).toBeGreaterThan(0);
    expect(Math.abs(joins - leaves)).toBeLessThanOrEqual(known.size);
  });
});
