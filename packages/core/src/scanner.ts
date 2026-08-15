import { COLLECTED_EXTENSIONS, isExcluded } from "./exclusions.js";
import type { FileSystem, PathUtil } from "./fileSystem.js";
import { parseDuplicateIndex } from "./nameKey.js";
import { PIPELINE_STAGE, type Problem, type ScannedFile } from "./types.js";

/** Everything a scan needs to run. */
export interface ScanOptions {
  fs: FileSystem;
  path: PathUtil;
  /** Absolute directories to walk. */
  roots: string[];
  /** The destination library, which is never scanned. */
  libraryRoot: string;
  onProgress?: (count: number, currentPath: string) => void;
}

/** Everything a scan produces. It writes nothing. */
export interface ScanResult {
  files: ScannedFile[];
  problems: Problem[];
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Walks the given roots and records every file worth collecting.
 *
 * The walk is iterative rather than recursive so that a pathologically deep
 * directory tree cannot exhaust the stack. Directories that cannot be read
 * become problems and do not stop the scan, because hitting a few unreadable
 * directories is normal when walking a whole machine.
 *
 * @param options - Filesystem, paths, roots, and the library to avoid
 * @returns The inventory and any problems encountered
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const { fs, path, roots, libraryRoot, onProgress } = options;

  const files: ScannedFile[] = [];
  const problems: Problem[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];

  for (const root of roots) {
    if (!isExcluded(root, libraryRoot, path)) {
      queue.push(root);
    }
  }

  while (queue.length > 0) {
    const directory = queue.shift();
    if (directory === undefined || visited.has(directory)) {
      continue;
    }
    visited.add(directory);

    let entries;
    try {
      entries = await fs.list(directory);
    } catch (error) {
      problems.push({
        path: directory,
        stage: PIPELINE_STAGE.SCAN,
        message: describeError(error),
      });
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink) {
        continue;
      }
      if (isExcluded(entry.path, libraryRoot, path)) {
        continue;
      }

      if (entry.isDirectory) {
        queue.push(entry.path);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const kind = COLLECTED_EXTENSIONS[ext];
      if (kind === undefined) {
        continue;
      }

      const stem = entry.name.slice(0, entry.name.length - ext.length);

      try {
        const stats = await fs.stat(entry.path);
        files.push({
          path: entry.path,
          stem,
          ext,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
          birthtimeMs: stats.birthtimeMs,
          deviceId: stats.deviceId,
          sourceDir: directory,
          duplicateIndex: parseDuplicateIndex(stem),
          kind,
        });
        onProgress?.(files.length, entry.path);
      } catch (error) {
        problems.push({
          path: entry.path,
          stage: PIPELINE_STAGE.SCAN,
          message: describeError(error),
        });
      }
    }
  }

  return { files, problems };
}
