import type { FileSystem, PathUtil } from "./fileSystem.js";
import { OPERATION_OUTCOME, type Journal } from "./journal.js";
import { PIPELINE_STAGE, type Problem } from "./types.js";

/** Everything needed to reverse a run. */
export interface UndoOptions {
  fs: FileSystem;
  path: PathUtil;
  journal: Journal;
  runId: string;
  onProgress?: (done: number, total: number, currentPath: string) => void;
}

/** What reversing a run achieved. */
export interface UndoResult {
  restored: number;
  problems: Problem[];
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Reverses a completed run by replaying its journal backwards.
 *
 * Entries are processed newest first so that a file moved twice ends up where
 * it started. Nothing is ever overwritten: if something already occupies the
 * original location, the entry is reported as a problem and skipped, because
 * an undo that destroys newer work is worse than an undo that stops short.
 *
 * Failed operations are skipped silently, since nothing was moved for them in
 * the first place.
 *
 * @param options - Filesystem, paths, the journal, and the run to reverse
 * @returns How many files were restored, and anything that could not be
 */
export async function undo(options: UndoOptions): Promise<UndoResult> {
  const { fs, path, journal, runId, onProgress } = options;

  const entries = (await journal.read(runId)).filter(
    (entry) => entry.outcome !== OPERATION_OUTCOME.FAILED,
  );
  const reversed = [...entries].reverse();

  const problems: Problem[] = [];
  let restored = 0;

  for (const [index, entry] of reversed.entries()) {
    try {
      if (!(await fs.exists(entry.to))) {
        problems.push({
          path: entry.to,
          stage: PIPELINE_STAGE.UNDO,
          message: "The file is no longer where the run left it.",
        });
        continue;
      }

      if (await fs.exists(entry.from)) {
        problems.push({
          path: entry.from,
          stage: PIPELINE_STAGE.UNDO,
          message: "Something already occupies the original location, so it was left alone.",
        });
        continue;
      }

      await fs.mkdir(path.dirname(entry.from));
      await fs.move(entry.to, entry.from);
      restored += 1;
    } catch (error) {
      problems.push({
        path: entry.to,
        stage: PIPELINE_STAGE.UNDO,
        message: describeError(error),
      });
    } finally {
      onProgress?.(index + 1, reversed.length, entry.to);
    }
  }

  return { restored, problems };
}
