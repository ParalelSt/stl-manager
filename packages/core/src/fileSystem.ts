/** One entry returned when listing a directory. */
export interface DirEntry {
  name: string;
  /** Absolute path of the entry. */
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/** Metadata for a single file. */
export interface FileStat {
  size: number;
  mtimeMs: number;
  /** Creation time, or 0 where the filesystem does not record one. */
  birthtimeMs: number;
  /** Volume identifier, used to detect moves that cross a filesystem. */
  deviceId: number;
}

/**
 * Every filesystem operation the engine is allowed to perform.
 *
 * The engine depends on this interface and never on node:fs directly, which
 * keeps it testable against an in-memory implementation and leaves room for a
 * remote peer or a cloud drive to implement the same surface later.
 */
export interface FileSystem {
  /** Lists the immediate children of a directory. Rejects if it cannot be read. */
  list(dir: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
  /** Creates a directory and any missing parents. Succeeds if it already exists. */
  mkdir(dir: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Returns a digest of the file's full contents. */
  hash(path: string): Promise<string>;
  /** Reads up to `length` bytes starting at `offset`. May return fewer at end of file. */
  readChunk(path: string, offset: number, length: number): Promise<Uint8Array>;
  /** Appends one line, creating the file and its parents if needed, and flushes it. */
  appendLine(path: string, line: string): Promise<void>;
  /** Reads a file as lines, with the trailing empty line removed. */
  readLines(path: string): Promise<string[]>;
  /** Bytes available on the volume holding the given path. */
  freeSpace(path: string): Promise<number>;
}

/**
 * Path manipulation, injected so the engine makes no assumption about the
 * platform's separator or about running on a real disk at all.
 */
export interface PathUtil {
  join(...segments: string[]): string;
  dirname(path: string): string;
  basename(path: string): string;
  /** Returns the extension including the leading dot, or an empty string. */
  extname(path: string): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
  /** Splits a path into its non-empty segments. */
  segments(path: string): string[];
}
