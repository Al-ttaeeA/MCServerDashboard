/**
 * Local API server: `npm run dev:api`.
 * Same Hono app as production, but on Node with DATABASE_URL (PGlite or Supabase).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { openDatabase } from "@smp/db/node";
import { createApp } from "./app";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
for (const name of [".env.local", ".env"]) {
  const path = join(root, name);
  if (existsSync(path)) process.loadEnvFile(path);
}

let url = process.env.DATABASE_URL ?? "pglite:.data/dev";
if (url.startsWith("pglite:") && url !== "pglite:memory") url = "pglite:" + join(root, url.slice(7));
const sql = await openDatabase(url);
const port = Number(process.env.API_PORT ?? 8787);

const server = new Hono();
server.use("/api/*", cors({ origin: (origin) => (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null) }));
server.route("/", createApp({ getSql: async () => ({ sql, release: async () => {} }) }));

serve({ fetch: server.fetch, port }, () => {
  console.log(`API listening on http://localhost:${port}/api (database: ${url.split(":")[0]})`);
});
