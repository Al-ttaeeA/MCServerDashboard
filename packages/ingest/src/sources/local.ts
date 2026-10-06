import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LogSource, RemoteFile } from "./types";

/** Reads logs from a local folder (e.g. a copy downloaded from the panel). */
export function createLocalSource(dir: string): LogSource {
  const root = resolve(dir);
  return {
    description: `local folder ${root}`,
    async list(): Promise<RemoteFile[]> {
      const names = await readdir(root);
      const files: RemoteFile[] = [];
      for (const name of names) {
        const s = await stat(join(root, name));
        if (s.isFile()) files.push({ name, size: s.size, mtimeMs: s.mtimeMs });
      }
      return files;
    },
    read: (name) => readFile(join(root, name)),
    async close() {},
  };
}
