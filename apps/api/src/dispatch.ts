/**
 * Starts the "Sync server logs" GitHub Actions workflow.
 *
 * Why: GitHub's own `schedule:` trigger is best-effort and frequently skips
 * runs (especially at :00/:30, GitHub's busiest minutes). Cloudflare Cron
 * Triggers fire reliably, so the Worker's scheduled handler calls GitHub's
 * workflow_dispatch API every 30 minutes instead. GitHub still does the
 * actual work (SFTP + parsing); Cloudflare is just a punctual alarm clock.
 *
 * Needs a fine-grained GitHub token with "Actions: Read and write" on this
 * repository only, stored as the Worker secret GITHUB_DISPATCH_TOKEN.
 */
export interface DispatchConfig {
  token: string | undefined;
  /** "owner/repo" */
  repo: string;
  workflow: string;
  ref: string;
}

export type DispatchResult = { ok: true } | { ok: false; reason: string };

export async function dispatchSync(cfg: DispatchConfig, fetchImpl: typeof fetch = fetch): Promise<DispatchResult> {
  if (!cfg.token) return { ok: false, reason: "GITHUB_DISPATCH_TOKEN is not set — skipping (see docs/deployment.md)" };
  const url = `https://api.github.com/repos/${cfg.repo}/actions/workflows/${cfg.workflow}/dispatches`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "smp-analytics-worker",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref: cfg.ref }),
  });
  // GitHub answers 204 No Content on success.
  if (res.status === 204) return { ok: true };
  const text = await res.text().catch(() => "");
  return { ok: false, reason: `GitHub returned ${res.status}: ${text.slice(0, 200)}` };
}
