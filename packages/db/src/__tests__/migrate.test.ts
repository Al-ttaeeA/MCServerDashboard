import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Sql } from "../executor";
import { migrate } from "../migrate";
import { createPgliteSql } from "../pglite";

let sql: Sql;
beforeEach(async () => {
  sql = await createPgliteSql();
});
afterEach(async () => {
  await sql.close();
});

describe("migrate", () => {
  it("applies all migrations once and is idempotent", async () => {
    const first = await migrate(sql);
    expect(first.length).toBeGreaterThan(0);
    expect(await migrate(sql)).toEqual([]);
    const tables = await sql.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'smp' order by 1",
    );
    expect(tables.map((t) => t.table_name)).toEqual(
      expect.arrayContaining(["players", "events", "sessions", "log_files", "player_stats"]),
    );
  });

  it("returns bigint as number and timestamptz as Date", async () => {
    await migrate(sql);
    const [row] = await sql.query<{ n: number; t: Date }>("select 9007199254740::bigint as n, now() as t");
    expect(row!.n).toBe(9007199254740);
    expect(row!.t).toBeInstanceOf(Date);
  });

  it("rolls back a failed transaction", async () => {
    await migrate(sql);
    await expect(
      sql.transaction(async (tx) => {
        await tx.query("insert into smp.sync_runs (mode) values ('sync')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await sql.query("select * from smp.sync_runs")).toEqual([]);
  });
});
