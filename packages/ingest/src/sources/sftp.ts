import SftpClient from "ssh2-sftp-client";
import type { LogSource, RemoteFile } from "./types";

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  /** Directory containing latest.log and the rotated .log.gz files. */
  logDir: string;
}

/**
 * SFTP is SSH-based file transfer. WiseHosting (like most game panels) runs
 * an SFTP server per game server, rooted at the server's folder, using your
 * panel credentials. We only ever list and download — never write.
 */
export async function createSftpSource(config: SftpConfig): Promise<LogSource> {
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
  const dir = config.logDir.replace(/\/+$/, "");
  return {
    description: `sftp://${config.host}:${config.port}${dir.startsWith("/") ? "" : "/"}${dir}`,
    async list(): Promise<RemoteFile[]> {
      const entries = await client.list(dir);
      return entries
        .filter((e) => e.type === "-")
        .map((e) => ({ name: e.name, size: e.size, mtimeMs: e.modifyTime }));
    },
    async read(name: string): Promise<Buffer> {
      const data = await client.get(`${dir}/${name}`);
      if (!Buffer.isBuffer(data)) throw new Error(`Unexpected SFTP response for ${name}`);
      return data;
    },
    async close() {
      await client.end();
    },
  };
}
