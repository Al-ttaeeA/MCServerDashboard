import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Sql } from "./executor";

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

/**
 * Applies pending `migrations/NNNN_name.sql` files in order, each in its own
 * transaction, recording them in `public.smp_migrations`. Safe to run repeatedly.
 */
export async function migrate(sql: Sql, log: (msg: string) => void = () => {}): Promise<string[]> {
  await sql.exec(`
    create table if not exists public.smp_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
    alter table public.smp_migrations enable row level security;
  `);
  const applied = new Set(
    (await sql.query<{ version: string }>("select version from public.smp_migrations")).map((r) => r.version),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    log(`Applying migration ${version}…`);
    const script = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await sql.transaction(async (tx) => {
      await tx.exec(script);
      await tx.query("insert into public.smp_migrations (version) values ($1)", [version]);
    });
    ran.push(version);
  }
  if (ran.length === 0) log("Database schema is up to date.");
  return ran;
}
