import { PGlite, types, type PGliteInterface, type Transaction } from "@electric-sql/pglite";
import type { Sql } from "./executor";

/**
 * PGlite adapter: an in-process Postgres for tests and local development.
 * @param dataDir directory to persist to, or undefined for in-memory.
 */
export async function createPgliteSql(dataDir?: string): Promise<Sql> {
  const db = await PGlite.create(dataDir, {
    parsers: { [types.INT8]: (x: string) => Number(x) },
  });
  return wrap(db, db);
}

function wrap(root: PGlite, conn: PGliteInterface | Transaction): Sql {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await conn.query<T>(text, params);
      return res.rows;
    },
    async exec(script: string) {
      await conn.exec(script);
    },
    async transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R> {
      if (conn !== root) return fn(wrap(root, conn));
      return root.transaction((tx) => fn(wrap(root, tx)));
    },
    async close() {
      await root.close();
    },
  };
}
