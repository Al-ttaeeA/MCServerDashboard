/**
 * Ingestion CLI.
 *
 *   npm run import:logs                 # historical import from WiseHosting (SFTP)
 *   npm run import:logs -- --dir samples  # … or from a local folder of logs
 *   npm run sync                        # incremental sync (what GitHub Actions runs)
 *   npm run sync -- --reparse           # re-parse all available files (after parser updates)
 *
 * import and sync run the same idempotent pipeline; `import` just prints
 * per-file progress. Running either twice never duplicates anything.
 */
import { parseArgs } from "node:util";
import { openDatabase } from "@smp/db/node";
import { ConfigError, loadEnvFiles, readIngestConfig, readSftpConfig, resolveFromRepoRoot } from "./config";
import { runIngestion, type IngestSummary } from "./pipeline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createLocalFs } from "./sources/local";
import { createSftpFs } from "./sources/sftp";
import { logSourceFrom, type LogSource, type ServerFs } from "./sources/types";

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      reparse: { type: "boolean", default: false },
    },
  });
  const mode = positionals[0];
  if (mode !== "import" && mode !== "sync") {
    console.error("Usage: cli.ts <import|sync> [--dir <folder>] [--reparse]");
    return 2;
  }

  loadEnvFiles();
  const config = readIngestConfig();

  let fs: ServerFs;
  let source: LogSource;
  let world: ServerFs | undefined;
  if (values.dir) {
    // A local copy of the server root (logs/, world/, server.properties), or just a folder of logs.
    const dir = resolveFromRepoRoot(values.dir);
    fs = createLocalFs(dir);
    const hasLogsDir = existsSync(join(dir, "logs"));
    source = logSourceFrom(fs, hasLogsDir ? "logs" : ".");
    world = hasLogsDir ? fs : undefined;
  } else {
    const sftp = readSftpConfig();
    console.log(`Connecting to WiseHosting (${sftp.host}:${sftp.port})…`);
    fs = await createSftpFs(sftp);
    source = logSourceFrom(fs, sftp.logDir);
    world = fs;
  }

  const sql = await openDatabase(config.databaseUrl);
  try {
    const summary = await runIngestion({
      source,
      world,
      sql,
      mode,
      serverTimeZone: config.serverTimeZone,
      statsTimeZone: config.statsTimeZone,
      reparse: values.reparse,
      log: (msg) => (mode === "import" || !msg.startsWith("    ") ? console.log(msg) : undefined),
    });
    printSummary(summary);
    return 0;
  } finally {
    await fs.close().catch(() => {});
    await sql.close().catch(() => {});
  }
}

function printSummary(s: IngestSummary) {
  const c = s.counts;
  console.log(`Processed ${s.newLines} new line(s) from ${s.filesProcessed} file(s) (${s.filesSkipped} unchanged)`);
  console.log(`Detected ${c.JOIN ?? 0} join(s), ${c.LEAVE ?? 0} leave(s), ${c.DEATH ?? 0} death(s), ${c.ADVANCEMENT ?? 0} advancement(s)`);
  console.log(`Inserted ${s.insertedEvents} event(s)`);
  console.log(`Rebuilt ${s.sessions} session(s) for ${s.players} player(s)` + (s.newPlayers ? ` — ${s.newPlayers} new player(s)` : ""));
  if (s.awards) console.log(`Assigned ${s.awards} award(s)`);
  if (s.openSessions) console.log(`${s.openSessions} player(s) currently online`);
  if (s.world) {
    const w = s.world;
    console.log(
      w.layout
        ? `World data (${w.worldDir}/, ${w.layout} layout): ${w.updated.stats} stats, ${w.updated.advancements} advancement, ${w.updated.playerdata} player-data file(s) updated, ${w.unchanged} unchanged` +
            (w.failed ? `, ${w.failed} failed` : "")
        : "World data: not found",
    );
  }
  if (s.newIssues) console.log(`⚠ ${s.newIssues} new parse issue(s) — see smp.parse_issues (${s.totalIssues} total)`);
  console.log(`Sync complete in ${(s.durationMs / 1000).toFixed(1)}s.`);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof ConfigError) console.error(`Configuration error: ${err.message}`);
    else console.error("Sync failed:", err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  },
);
