import type { FileSystem, PathUtil } from "./fileSystem.js";
import { MOVE_REASON, type MoveReason } from "./types.js";

/** What happened to a single file during an apply run. */
export const OPERATION_OUTCOME = {
  MOVED: "moved",
  COPIED: "copied",
  FAILED: "failed",
} as const;

/** One of the outcomes an operation can have. */
export type OperationOutcome = (typeof OPERATION_OUTCOME)[keyof typeof OPERATION_OUTCOME];

/** A single recorded operation. */
export interface JournalEntry {
  runId: string;
  /** Milliseconds since the epoch, recorded when the operation completed. */
  at: number;
  from: string;
  to: string;
  reason: MoveReason;
  outcome: OperationOutcome;
  error?: string;
}

/** A past run, as shown in the history screen. */
export interface RunSummary {
  runId: string;
  /** When the run's first recorded operation completed. */
  at: number;
  moved: number;
  failed: number;
}

/** The directory inside the library holding application state. */
export const STATE_FOLDER = ".stl-manager";

/** The journal filename inside the state folder. */
export const JOURNAL_FILENAME = "journal.jsonl";

const OUTCOMES: ReadonlySet<string> = new Set(Object.values(OPERATION_OUTCOME));
const REASONS: ReadonlySet<string> = new Set(Object.values(MOVE_REASON));

function isOperationOutcome(value: string): value is OperationOutcome {
  return OUTCOMES.has(value);
}

function isMoveReason(value: string): value is MoveReason {
  return REASONS.has(value);
}

/**
 * Narrows a parsed JSON value to a journal entry.
 *
 * Lines are validated rather than trusted because the journal is a file on
 * disk that a user can edit, and because a run interrupted by a power cut can
 * leave a partially written final line.
 */
function toEntry(value: unknown): JournalEntry | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record: Record<string, unknown> = { ...value };
  const { runId, at, from, to, reason, outcome, error } = record;

  if (
    typeof runId !== "string" ||
    typeof at !== "number" ||
    typeof from !== "string" ||
    typeof to !== "string" ||
    typeof reason !== "string" ||
    typeof outcome !== "string" ||
    !isMoveReason(reason) ||
    !isOperationOutcome(outcome)
  ) {
    return undefined;
  }

  const entry: JournalEntry = { runId, at, from, to, reason, outcome };
  if (typeof error === "string") {
    entry.error = error;
  }
  return entry;
}

/**
 * An append-only record of every file operation the application performed.
 *
 * Entries are written as work completes rather than at the end of a run, so a
 * run interrupted by a crash or a power cut is still fully undoable. Undo is
 * simply this file replayed backwards.
 */
export class Journal {
  readonly #path: string;

  constructor(
    private readonly fs: FileSystem,
    path: PathUtil,
    libraryRoot: string,
  ) {
    this.#path = path.join(libraryRoot, STATE_FOLDER, JOURNAL_FILENAME);
  }

  /** Absolute path of the journal file. */
  get location(): string {
    return this.#path;
  }

  /** Records one completed operation and flushes it to disk immediately. */
  async append(entry: JournalEntry): Promise<void> {
    await this.fs.appendLine(this.#path, JSON.stringify(entry));
  }

  /**
   * Reads recorded operations in the order they happened.
   *
   * @param runId - Limits the result to one run. Omit to read every run.
   */
  async read(runId?: string): Promise<JournalEntry[]> {
    const lines = await this.fs.readLines(this.#path);
    const entries: JournalEntry[] = [];

    for (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const entry = toEntry(parsed);
      if (entry === undefined) {
        continue;
      }
      if (runId === undefined || entry.runId === runId) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /** Summarises every recorded run, newest first. */
  async listRuns(): Promise<RunSummary[]> {
    const entries = await this.read();
    const runs = new Map<string, RunSummary>();

    for (const entry of entries) {
      const existing = runs.get(entry.runId) ?? {
        runId: entry.runId,
        at: entry.at,
        moved: 0,
        failed: 0,
      };
      if (entry.outcome === OPERATION_OUTCOME.FAILED) {
        existing.failed += 1;
      } else {
        existing.moved += 1;
      }
      existing.at = Math.min(existing.at, entry.at);
      runs.set(entry.runId, existing);
    }

    return [...runs.values()].sort((left, right) => right.at - left.at);
  }
}
