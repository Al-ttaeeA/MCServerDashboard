/**
 * Cloudflare Worker entry point.
 *
 * - `/api/*` → Hono API, talking to Supabase through Hyperdrive
 *   (Cloudflare's connection pooler + query cache for Postgres).
 * - everything else → the static Next.js export (`apps/web/out`), served from
 *   Workers Static Assets. Static asset requests are free and unlimited.
 * - every 30 minutes (Cron Trigger) → starts the GitHub Actions log sync,
 *   because GitHub's own schedule skips runs (see dispatch.ts).
 */
import { createPostgresSql } from "@smp/db/postgres";
import { createApp } from "./app";
import { dispatchSync } from "./dispatch";

export interface Env {
  HYPERDRIVE: Hyperdrive;
  ASSETS: Fetcher;
  /** Secret: fine-grained GitHub token with Actions read/write on the repo. */
  GITHUB_DISPATCH_TOKEN?: string;
  /** "owner/repo" (wrangler.jsonc vars). */
  GITHUB_REPO: string;
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

  async scheduled(_controller, env) {
    const result = await dispatchSync({ token: env.GITHUB_DISPATCH_TOKEN, repo: env.GITHUB_REPO, workflow: "sync.yml", ref: "main" });
    if (result.ok) console.log("Triggered GitHub log sync");
    else console.warn(`Log sync not triggered: ${result.reason}`);
  },
} satisfies ExportedHandler<Env>;
