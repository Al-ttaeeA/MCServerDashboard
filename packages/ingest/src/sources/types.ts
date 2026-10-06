/**
 * Read-only access to the Minecraft server's files: WiseHosting over SFTP,
 * or a local folder laid out like the server (for development).
 */
export interface RemoteFile {
  name: string;
  size: number;
  /** Last-modified time (ms since epoch). Used to date latest.log and skip unchanged files. */
  mtimeMs: number;
  isDirectory: boolean;
}

export interface ServerFs {
  /** Human-readable description for progress output (never includes secrets). */
  readonly description: string;
  /** Lists a directory relative to the server root. Throws if it doesn't exist. */
  list(dir: string): Promise<RemoteFile[]>;
  read(path: string): Promise<Buffer>;
  close(): Promise<void>;
}

/** The log folder view used by the log pipeline. */
export interface LogSource {
  readonly description: string;
  list(): Promise<RemoteFile[]>;
  read(name: string): Promise<Buffer>;
  close(): Promise<void>;
}

export function logSourceFrom(fs: ServerFs, logDir: string): LogSource {
  const dir = logDir.replace(/\/+$/, "") || ".";
  const join = (name: string) => (dir === "." ? name : `${dir}/${name}`);
  return {
    description: `${fs.description}${dir === "." ? "" : `/${dir}`}`,
    list: async () => (await fs.list(dir)).filter((f) => !f.isDirectory),
    read: (name) => fs.read(join(name)),
    close: () => fs.close(),
  };
}
