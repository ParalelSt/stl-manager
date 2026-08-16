import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DirEntry, FileStat, FileSystem } from "./fileSystem.js";

/** How much of a file is read at a time when hashing. */
const HASH_CHUNK_BYTES = 1024 * 1024;

/**
 * The FileSystem implementation used by the running application.
 *
 * This is the only module permitted to import node:fs. The lint configuration
 * enforces that, so the engine cannot accidentally grow a direct dependency on
 * the disk and lose its testability.
 */
export class NodeFileSystem implements FileSystem {
  async list(dir: string): Promise<DirEntry[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: join(dir, entry.name),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  }

  async stat(path: string): Promise<FileStat> {
    const stats = await stat(path);
    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      birthtimeMs: stats.birthtimeMs,
      deviceId: stats.dev,
    };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async move(from: string, to: string): Promise<void> {
    await rename(from, to);
  }

  async copy(from: string, to: string): Promise<void> {
    await copyFile(from, to);
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  /**
   * Digests a file by streaming it, so a multi-gigabyte mesh is never held in
   * memory in order to compare it against another.
   */
  async hash(path: string): Promise<string> {
    const digest = createHash("sha256");
    const stream = createReadStream(path, { highWaterMark: HASH_CHUNK_BYTES });
    for await (const chunk of stream) {
      digest.update(chunk);
    }
    return digest.digest("hex");
  }

  async readChunk(path: string, offset: number, length: number): Promise<Uint8Array> {
    const handle = await open(path, "r");
    try {
      const buffer = new Uint8Array(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  /**
   * Appends a line and flushes it to the physical disk before returning.
   *
   * The flush is what lets an apply run survive a power cut with an undoable
   * journal. Without it the last operations could be lost from the record
   * while having already happened on disk.
   */
  async appendLine(path: string, line: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const handle = await open(path, "a");
    try {
      await handle.writeFile(`${line}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async readLines(path: string): Promise<string[]> {
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch {
      return [];
    }
    const lines = contents.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }
    return lines;
  }

  async freeSpace(path: string): Promise<number> {
    const stats = await statfs(path);
    return Number(stats.bsize) * Number(stats.bavail);
  }
}
