/**
 * The minimal database interface the rest of the codebase depends on.
 *
 * Two adapters implement it:
 * - `postgres.js` (production: ingester in GitHub Actions, API Worker via Hyperdrive)
 * - PGlite (tests and local development — real Postgres compiled to WASM)
 *
 * Conventions both adapters guarantee: int8/bigint → number, timestamptz →
 * Date, jsonb → parsed JSON.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script without parameters (migrations). */
  exec(script: string): Promise<void>;
  transaction<R>(fn: (tx: Sql) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}
