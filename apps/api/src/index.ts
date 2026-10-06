/**
 * Cloudflare Worker entry point.
 *
 * - `/api/*` → Hono API, talking to Supabase through Hyperdrive
 *   (Cloudflare's connection pooler + query cache for Postgres).
 * - everything else → the static Next.js export (`apps/web/out`), served from
 *   Workers Static Assets. Static asset requests are free and unlimited.
 */
import { createPostgresSql } from "@smp/db/postgres";
import { createApp } from "./app";

export interface Env {
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
}

const app = createApp({
  async getSql(c) {
    const env = c.env as Env;
    // Hyperdrive pools connections on Cloudflare's side; a small per-request client is the recommended pattern.
    const sql = createPostgresSql(env.HYPERDRIVE.connectionString, { max: 3, prepare: false });
    return { sql, release: () => sql.close() };
  },
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
