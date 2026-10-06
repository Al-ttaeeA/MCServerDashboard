import { mkdirSync } from "node:fs";
import type { Sql } from "./executor";
import { migrate } from "./migrate";

/**
 * Opens a database from a URL:
 * - `postgres://…` / `postgresql://…` → real Postgres (Supabase)
 * - `pglite:<dir>` → local file-backed PGlite (dev), `pglite:memory` → in-memory
 *
 * PGlite databases are migrated automatically since they're local throwaways.
 */
export async function openDatabase(url: string): Promise<Sql> {
  if (url.startsWith("pglite:")) {
    const { createPgliteSql } = await import("./pglite");
    const target = url.slice("pglite:".length);
    if (target !== "memory") mkdirSync(target, { recursive: true });
    const sql = await createPgliteSql(target === "memory" ? undefined : target);
    await migrate(sql);
    return sql;
  }
  const { createPostgresSql } = await import("./postgres");
  return createPostgresSql(url);
}
