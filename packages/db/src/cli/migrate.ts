/**
 * `npm run db:migrate` — applies schema migrations to DATABASE_URL.
 */
import { createPostgresSql } from "../postgres";
import { migrate } from "../migrate";

const url = process.env.DATABASE_URL;
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
