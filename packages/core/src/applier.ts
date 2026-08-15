import type { FileSystem, PathUtil } from "./fileSystem.js";
import { OPERATION_OUTCOME, type Journal, type OperationOutcome } from "./journal.js";
import type { PlannedMove, SortPlan } from "./planner.js";
import { PIPELINE_STAGE, type Problem } from "./types.js";

/** Everything needed to execute a plan. */
export interface ApplyOptions {
  fs: FileSystem;
  path: PathUtil;
  plan: SortPlan;
  journal: Journal;
  runId: string;
  /** Supplies the timestamp for journal entries. Injected so tests are stable. */
  now?: () => number;
  onProgress?: (done: number, total: number, currentPath: string) => void;
}

/** What executing a plan achieved. */
export interface ApplyResult {
  moved: number;
  failed: number;
  /** Files that changed or vanished between the scan and the run. */
  skipped: number;
  problems: Problem[];
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Confirms every source is still exactly as the scan found it.
 *
 * A file that changed size since the plan was built is no longer the file the
 * user reviewed, so moving it would be acting on stale information.
 */
async function preflight(
  moves: PlannedMove[],
  fs: FileSystem,
): Promise<{ ready: PlannedMove[]; problems: Problem[] }> {
  const ready: PlannedMove[] = [];
  const problems: Problem[] = [];

  for (const move of moves) {
    try {
      const stats = await fs.stat(move.from);
      if (stats.size !== move.size) {
        problems.push({
          path: move.from,
          stage: PIPELINE_STAGE.APPLY,
          message: "The file changed since it was scanned, so it was left alone.",
        });
        continue;
      }
      ready.push(move);
    } catch {
      problems.push({
        path: move.from,
        stage: PIPELINE_STAGE.APPLY,
        message: "The file is no longer where the scan found it.",
      });
    }
  }

  return { ready, problems };
}

/**
 * Moves one file, falling back to copy and remove across volumes.
 *
 * The order matters: the copy must be confirmed before the source is removed,
 * so a failure part way through leaves the original intact.
 */
async function moveOne(
  move: PlannedMove,
  fs: FileSystem,
  path: PathUtil,
): Promise<OperationOutcome> {
  await fs.mkdir(path.dirname(move.to));

  try {
    await fs.move(move.from, move.to);
    return OPERATION_OUTCOME.MOVED;
  } catch (error) {
    const isCrossDevice = describeError(error).includes("EXDEV");
    if (!isCrossDevice) {
      throw error;
    }
  }

  await fs.copy(move.from, move.to);

  const copied = await fs.stat(move.to);
  if (copied.size !== move.size) {
    throw new Error("The copy did not match the original, so the source was kept.");
  }

  await fs.remove(move.from);
  return OPERATION_OUTCOME.COPIED;
}

/**
 * Executes a plan, recording every completed operation as it goes.
 *
 * Runs a preflight over the whole plan before the first write: sources are
 * re-checked against the scan, and the destination is checked for room. If
 * there is not enough space the run throws before touching anything, since a
 * half-applied plan that ran out of disk is the worst outcome available.
 *
 * During execution a failing file is recorded and the run continues. One
 * unreadable file must not stop ten thousand moves.
 *
 * @param options - Filesystem, paths, the plan, and the journal to write to
 * @returns Counts of what happened, plus every problem encountered
 */
export async function apply(options: ApplyOptions): Promise<ApplyResult> {
  const { fs, path, plan, journal, runId, now = Date.now, onProgress } = options;

  const { ready, problems } = await preflight(plan.moves, fs);

  const requiredBytes = ready.reduce((total, move) => total + move.size, 0);
  const available = await fs.freeSpace(plan.libraryRoot);
  if (available < requiredBytes) {
    throw new Error(
      `Not enough free space in the library: ${requiredBytes} bytes needed, ${available} available.`,
    );
  }

  let moved = 0;
  let failed = 0;

  for (const [index, move] of ready.entries()) {
    try {
      const outcome = await moveOne(move, fs, path);
      moved += 1;
      await journal.append({
        runId,
        at: now(),
        from: move.from,
        to: move.to,
        reason: move.reason,
        outcome,
      });
    } catch (error) {
      failed += 1;
      const message = describeError(error);
      problems.push({ path: move.from, stage: PIPELINE_STAGE.APPLY, message });
      await journal.append({
        runId,
        at: now(),
        from: move.from,
        to: move.to,
        reason: move.reason,
        outcome: OPERATION_OUTCOME.FAILED,
        error: message,
      });
    } finally {
      onProgress?.(index + 1, ready.length, move.from);
    }
  }

  return { moved, failed, skipped: plan.moves.length - ready.length, problems };
}
