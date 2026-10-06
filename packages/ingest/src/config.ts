import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertValidTimeZone } from "@smp/core";
import type { SftpConfig } from "./sources/sftp";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Loads `.env.local` / `.env` from the repo root for local runs. In GitHub Actions, secrets arrive as real env vars. */
export function loadEnvFiles(): void {
  for (const name of [".env.local", ".env"]) {
    const path = join(REPO_ROOT, name);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

export class ConfigError extends Error {}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new ConfigError(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

export interface IngestConfig {
  databaseUrl: string;
  serverTimeZone: string;
  statsTimeZone: string;
}

export function readIngestConfig(): IngestConfig {
  const serverTimeZone = process.env.SERVER_LOG_TIMEZONE?.trim() || "UTC";
  const statsTimeZone = process.env.STATS_TIMEZONE?.trim() || "America/New_York";
  assertValidTimeZone(serverTimeZone);
  assertValidTimeZone(statsTimeZone);
  let databaseUrl = required("DATABASE_URL");
  // Local PGlite paths are relative to the repo root, wherever the command runs from.
  if (databaseUrl.startsWith("pglite:") && databaseUrl !== "pglite:memory") {
    databaseUrl = "pglite:" + resolveFromRepoRoot(databaseUrl.slice("pglite:".length));
  }
  return { databaseUrl, serverTimeZone, statsTimeZone };
}

export function readSftpConfig(): SftpConfig {
  const port = Number(process.env.SFTP_PORT?.trim() || "22");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new ConfigError("SFTP_PORT must be a port number.");
  return {
    host: required("SFTP_HOST"),
    port,
    username: required("SFTP_USERNAME"),
    password: required("SFTP_PASSWORD"),
    logDir: process.env.SFTP_LOG_DIR?.trim() || "logs",
  };
}

export const resolveFromRepoRoot = (p: string) => (/^([a-z]:)?[\/]/i.test(p) ? p : join(REPO_ROOT, p));
