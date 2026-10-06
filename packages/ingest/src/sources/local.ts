import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RemoteFile, ServerFs } from "./types";

/** Reads a local folder laid out like the server root (logs/, world/, server.properties). */
export function createLocalFs(root: string): ServerFs {
  const base = resolve(root);
  return {
    description: `local folder ${base}`,
    async list(dir: string): Promise<RemoteFile[]> {
      const full = join(base, dir);
      const files: RemoteFile[] = [];
      for (const name of await readdir(full)) {
        const s = await stat(join(full, name));
        files.push({ name, size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() });
      }
      return files;
    },
    read: (path) => readFile(join(base, path)),
    async close() {},
  };
}
