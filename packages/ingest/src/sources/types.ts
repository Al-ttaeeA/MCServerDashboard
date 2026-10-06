/** Where log files come from: WiseHosting over SFTP, or a local folder. */
export interface RemoteFile {
  name: string;
  size: number;
  /** Last-modified time (ms since epoch). Used to date latest.log. */
  mtimeMs: number;
}

export interface LogSource {
  /** Human-readable description for progress output (never includes secrets). */
  readonly description: string;
  list(): Promise<RemoteFile[]>;
  read(name: string): Promise<Buffer>;
  close(): Promise<void>;
}
