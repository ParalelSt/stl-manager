import type { DirEntry, FileStat, FileSystem } from "./fileSystem.js";

/** A file supplied to MemoryFileSystem when seeding it. */
export interface MemorySeedEntry {
  content: string;
  mtimeMs?: number;
  birthtimeMs?: number;
}

/** Controls how MemoryFileSystem reports volumes and capacity. */
export interface MemoryFileSystemOptions {
  /** Maps a path prefix to the device id reported for paths beneath it. */
  volumes?: Record<string, number>;
  freeSpace?: number;
}

interface MemoryEntry {
  content: string;
  mtimeMs: number;
  birthtimeMs: number;
}

/**
 * A fixed starting point for generated timestamps.
 *
 * Seeded files are stamped from this base in insertion order, so tests that
 * depend on one file being newer than another are deterministic.
 */
const BASE_TIME_MS = 1_700_000_000_000;

const DEFAULT_DEVICE_ID = 1;

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }
  return path.slice(0, index);
}

/**
 * An in-memory FileSystem for tests.
 *
 * Directories are implied by the paths of the files it holds, so seeding a
 * file at /a/b/c.stl makes /a and /a/b listable without declaring them.
 */
export class MemoryFileSystem implements FileSystem {
  readonly #files = new Map<string, MemoryEntry>();
  readonly #directories = new Set<string>();
  readonly #symlinks = new Map<string, string>();
  readonly #denied = new Set<string>();
  readonly #volumes: [string, number][];
  readonly #freeSpace: number;
  #clock = BASE_TIME_MS;

  constructor(
    seed: Record<string, MemorySeedEntry> = {},
    options: MemoryFileSystemOptions = {},
  ) {
    this.#volumes = Object.entries(options.volumes ?? {}).sort(
      (left, right) => right[0].length - left[0].length,
    );
    this.#freeSpace = options.freeSpace ?? Number.MAX_SAFE_INTEGER;
    for (const [path, entry] of Object.entries(seed)) {
      this.#write(normalizePath(path), entry);
    }
  }

  #write(path: string, entry: MemorySeedEntry): void {
    this.#clock += 1;
    this.#files.set(path, {
      content: entry.content,
      mtimeMs: entry.mtimeMs ?? this.#clock,
      birthtimeMs: entry.birthtimeMs ?? this.#clock,
    });
  }

  #directoryExists(dir: string): boolean {
    if (dir === "/") {
      return true;
    }
    if (this.#directories.has(dir)) {
      return true;
    }
    const prefix = `${dir}/`;
    for (const path of this.#files.keys()) {
      if (path.startsWith(prefix)) {
        return true;
      }
    }
    for (const path of this.#directories) {
      if (path.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  #deviceFor(path: string): number {
    for (const [prefix, deviceId] of this.#volumes) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return deviceId;
      }
    }
    return DEFAULT_DEVICE_ID;
  }

  #read(path: string): MemoryEntry {
    const entry = this.#files.get(normalizePath(path));
    if (entry === undefined) {
      throw new Error(`ENOENT: no such file, open '${path}'`);
    }
    return entry;
  }

  /** Declares a directory that holds no files, so it can still be listed. */
  seedDirectory(dir: string): void {
    this.#directories.add(normalizePath(dir));
  }

  /** Declares a symbolic link, which the scanner must record but not follow. */
  seedSymlink(linkPath: string, target: string): void {
    this.#symlinks.set(normalizePath(linkPath), normalizePath(target));
  }

  /** Makes listing a directory fail, standing in for a permission error. */
  denyRead(dir: string): void {
    this.#denied.add(normalizePath(dir));
  }

  /** Returns the full contents keyed by path, for asserting nothing changed. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(
      [...this.#files.entries()].map(([path, entry]) => [path, entry.content]),
    );
  }

  async list(dir: string): Promise<DirEntry[]> {
    const normalized = normalizePath(dir);
    if (this.#denied.has(normalized)) {
      throw new Error(`EACCES: permission denied, scandir '${dir}'`);
    }
    if (!this.#directoryExists(normalized)) {
      throw new Error(`ENOENT: no such directory, scandir '${dir}'`);
    }
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const children = new Map<string, { isDirectory: boolean; isSymbolicLink: boolean }>();

    const record = (path: string, isExplicitDirectory: boolean, isLink: boolean): void => {
      if (!path.startsWith(prefix)) {
        return;
      }
      const remainder = path.slice(prefix.length);
      if (remainder === "") {
        return;
      }
      const slash = remainder.indexOf("/");
      const name = slash === -1 ? remainder : remainder.slice(0, slash);
      const existing = children.get(name);
      children.set(name, {
        isDirectory: (existing?.isDirectory ?? false) || slash !== -1 || isExplicitDirectory,
        isSymbolicLink: (existing?.isSymbolicLink ?? false) || isLink,
      });
    };

    for (const path of this.#files.keys()) {
      record(path, false, false);
    }
    for (const path of this.#directories) {
      record(path, true, false);
    }
    for (const path of this.#symlinks.keys()) {
      record(path, true, true);
    }

    return [...children.entries()]
      .map(([name, flags]) => ({
        name,
        path: `${prefix}${name}`,
        isDirectory: flags.isDirectory,
        isSymbolicLink: flags.isSymbolicLink,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async stat(path: string): Promise<FileStat> {
    const entry = this.#read(path);
    return {
      size: entry.content.length,
      mtimeMs: entry.mtimeMs,
      birthtimeMs: entry.birthtimeMs,
      deviceId: this.#deviceFor(normalizePath(path)),
    };
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    return this.#files.has(normalized) || this.#directoryExists(normalized);
  }

  async mkdir(dir: string): Promise<void> {
    let current = normalizePath(dir);
    while (current !== "/" && current !== "") {
      this.#directories.add(current);
      current = parentOf(current);
    }
  }

  async move(from: string, to: string): Promise<void> {
    const entry = this.#read(from);
    this.#files.delete(normalizePath(from));
    this.#files.set(normalizePath(to), entry);
  }

  async copy(from: string, to: string): Promise<void> {
    const entry = this.#read(from);
    this.#files.set(normalizePath(to), { ...entry });
  }

  async remove(path: string): Promise<void> {
    this.#files.delete(normalizePath(path));
    this.#directories.delete(normalizePath(path));
  }

  async hash(path: string): Promise<string> {
    const entry = this.#read(path);
    let value = 0x811c9dc5;
    for (let index = 0; index < entry.content.length; index += 1) {
      value ^= entry.content.charCodeAt(index);
      value = Math.imul(value, 0x01000193) >>> 0;
    }
    return `${value.toString(16)}-${entry.content.length}`;
  }

  async readChunk(path: string, offset: number, length: number): Promise<Uint8Array> {
    const entry = this.#read(path);
    const bytes = new TextEncoder().encode(entry.content);
    return bytes.slice(offset, offset + length);
  }

  async appendLine(path: string, line: string): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.#files.get(normalized);
    if (existing === undefined) {
      this.#write(normalized, { content: `${line}\n` });
      return;
    }
    existing.content += `${line}\n`;
    this.#clock += 1;
    existing.mtimeMs = this.#clock;
  }

  async readLines(path: string): Promise<string[]> {
    const entry = this.#files.get(normalizePath(path));
    if (entry === undefined) {
      return [];
    }
    const lines = entry.content.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return lines;
  }

  async freeSpace(): Promise<number> {
    return this.#freeSpace;
  }
}
