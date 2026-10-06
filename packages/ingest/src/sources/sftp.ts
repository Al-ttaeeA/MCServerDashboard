import SftpClient from "ssh2-sftp-client";
import type { RemoteFile, ServerFs } from "./types";

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Directory containing latest.log and the rotated .log.gz files. */
  logDir: string;
}

/**
 * SFTP is SSH-based file transfer. WiseHosting runs an SFTP server per game
 * server, rooted at the server's folder. We only ever list and download —
 * never write.
 */
export async function createSftpFs(config: SftpConfig): Promise<ServerFs> {
  const client = new SftpClient("smp-ingest");
  await client.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    readyTimeout: 20_000,
    retries: 2,
    retry_minTimeout: 2_000,
  });
  return {
    description: `sftp://${config.host}:${config.port}`,
    async list(dir: string): Promise<RemoteFile[]> {
      const entries = await client.list(dir);
      return entries
        .filter((e) => e.type === "-" || e.type === "d")
        .map((e) => ({ name: e.name, size: e.size, mtimeMs: e.modifyTime, isDirectory: e.type === "d" }));
    },
    async read(path: string): Promise<Buffer> {
      const data = await client.get(path);
      if (!Buffer.isBuffer(data)) throw new Error(`Unexpected SFTP response for ${path}`);
      return data;
    },
    async close() {
      await client.end();
    },
  };
}
