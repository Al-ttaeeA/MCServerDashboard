/**
 * `npm run db:migrate` — applies schema migrations to DATABASE_URL.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresSql } from "../postgres";
import { migrate } from "../migrate";

// Local runs read .env.local / .env from the repo root; CI passes real env vars.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
for (const name of [".env.local", ".env"]) {
  const path = join(root, name);
  if (existsSync(path)) process.loadEnvFile(path);
}

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set. See .env.example.");
  process.exit(1);
}

const sql = createPostgresSql(url, { max: 1 });
try {
  const ran = await migrate(sql, console.log);
  console.log(ran.length ? `Applied ${ran.length} migration(s).` : "Nothing to apply.");
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.close();
}
