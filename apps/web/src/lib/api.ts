"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * API base URL. In production the site and API share an origin, so this is
 * empty. Locally, the Node API runs on another port (apps/web/.env.development).
 * Public by design — it's just a URL, never a secret.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, { signal, headers: { accept: "application/json" } });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(message, res.status);
  }
  return (await res.json()) as T;
}

export type ApiState<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "error"; data: T | undefined; error: Error }
  | { status: "success"; data: T; error: undefined };

const cache = new Map<string, { at: number; data: unknown }>();
const FRESH_MS = 60_000;

interface Result<T> {
  path: string | null;
  data?: T;
  error?: Error;
}

/**
 * Minimal data-fetching hook: in-memory cache shared across components,
 * abort on unmount, and a background refresh every few minutes so an open
 * tab stays current (the server syncs every ~30 min). While refreshing or
 * after an error, the last good data stays on screen.
 */
export function useApi<T>(path: string | null, { refreshMs = 5 * 60_000 } = {}) {
  const [result, setResult] = useState<Result<T>>({ path: null });

  const load = useCallback(
    (signal?: AbortSignal): Promise<void> => {
      if (!path) return Promise.resolve();
      return apiGet<T>(path, signal).then(
        (data) => {
          cache.set(path, { at: Date.now(), data });
          setResult({ path, data });
        },
        (err: unknown) => {
          if (signal?.aborted) return;
          const error = err instanceof Error ? err : new Error(String(err));
          setResult((prev) => ({ path, data: prev.path === path ? prev.data : (cache.get(path)?.data as T | undefined), error }));
        },
      );
    },
    [path],
  );

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const hit = cache.get(path);
    if (!hit || Date.now() - hit.at > FRESH_MS) void load(controller.signal);
    const timer = refreshMs > 0 ? setInterval(() => void load(), refreshMs) : undefined;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, load, refreshMs]);

  // Derive what to show for the *current* path (falls back to the shared cache).
  const current: Result<T> = result.path === path ? result : { path, data: path ? (cache.get(path)?.data as T | undefined) : undefined };
  const reload = () => void load();
  let state: ApiState<T>;
  if (current.error) state = { status: "error", data: current.data, error: current.error };
  else if (current.data !== undefined) state = { status: "success", data: current.data, error: undefined };
  else state = { status: "loading", data: undefined, error: undefined };
  return { ...state, reload };
}
