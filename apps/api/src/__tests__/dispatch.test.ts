import { describe, expect, it, vi } from "vitest";
import { dispatchSync } from "../dispatch";

const cfg = { token: "ghp_test", repo: "owner/repo", workflow: "sync.yml", ref: "main" };

describe("dispatchSync", () => {
  it("calls GitHub's workflow_dispatch API with the token and ref", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await dispatchSync(cfg, fetchMock as unknown as typeof fetch)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/owner/repo/actions/workflows/sync.yml/dispatches");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer ghp_test");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "main" });
  });

  it("skips without a token instead of failing", async () => {
    const fetchMock = vi.fn();
    const r = await dispatchSync({ ...cfg, token: undefined }, fetchMock as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports GitHub errors (e.g. a token without Actions permission)", async () => {
    const fetchMock = vi.fn(async () => new Response('{"message":"Resource not accessible by personal access token"}', { status: 403 }));
    const r = await dispatchSync(cfg, fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.reason).toContain("403");
  });
});
