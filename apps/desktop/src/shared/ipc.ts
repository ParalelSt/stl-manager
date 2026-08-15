import { z } from "zod";

/**
 * The names of every operation the renderer can ask the main process to run.
 *
 * The renderer never imports the engine. It only ever sends one of these, which
 * is what keeps phase 2 a matter of swapping the transport rather than
 * rewriting the application.
 */
export const IPC_CHANNEL = {
  CHOOSE_DIRECTORY: "chooseDirectory",
  BUILD_PLAN: "buildPlan",
  APPLY_PLAN: "applyPlan",
  LIST_RUNS: "listRuns",
  UNDO_RUN: "undoRun",
  READ_LIBRARY: "readLibrary",
  REVEAL_IN_FINDER: "revealInFinder",
  PROGRESS: "progress",
} as const;

/** One of the operation names. */
export type IpcChannel = (typeof IPC_CHANNEL)[keyof typeof IPC_CHANNEL];

/** A scan and plan request. */
export const buildPlanRequestSchema = z.object({
  roots: z.array(z.string().min(1)).min(1),
  libraryRoot: z.string().min(1),
});

/** Validated shape of a plan request. */
export type BuildPlanRequest = z.infer<typeof buildPlanRequestSchema>;

const moveSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  groupId: z.string(),
  reason: z.enum(["model", "companion", "duplicate"]),
  size: z.number().nonnegative(),
});

/** An apply request carrying the plan exactly as the user reviewed it. */
export const applyPlanRequestSchema = z.object({
  libraryRoot: z.string().min(1),
  moves: z.array(moveSchema),
});

/** Validated shape of an apply request. */
export type ApplyPlanRequest = z.infer<typeof applyPlanRequestSchema>;

/** An undo request naming a single past run. */
export const undoRunRequestSchema = z.object({
  libraryRoot: z.string().min(1),
  runId: z.string().min(1),
});

/** Validated shape of an undo request. */
export type UndoRunRequest = z.infer<typeof undoRunRequestSchema>;

/** A request to list past runs from a library's journal. */
export const listRunsRequestSchema = z.object({
  libraryRoot: z.string().min(1),
});

/** Validated shape of a list runs request. */
export type ListRunsRequest = z.infer<typeof listRunsRequestSchema>;

/** Which long-running operation a progress event describes. */
export const PROGRESS_KIND = {
  SCAN: "scan",
  APPLY: "apply",
  UNDO: "undo",
} as const;

/** One of the long-running operations. */
export type ProgressKind = (typeof PROGRESS_KIND)[keyof typeof PROGRESS_KIND];

/** A progress update streamed from the main process while work is running. */
export interface ProgressEvent {
  kind: ProgressKind;
  done: number;
  /** Total operations, or undefined during a scan where the total is unknown. */
  total: number | undefined;
  currentPath: string;
}

/**
 * Validates an untrusted request against its schema.
 *
 * Requests arrive over IPC, which is the only place untrusted input enters the
 * main process, so they are parsed rather than assumed. A failure returns a
 * message instead of throwing, so the caller decides how to surface it.
 *
 * @param schema - The schema describing the expected shape
 * @param value - The untrusted value received over IPC
 * @returns The parsed value, or the reason it was rejected
 */
export function parseRequest<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
): { ok: true; value: Output } | { ok: false; error: string } {
  const result = schema.safeParse(value);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const first = result.error.issues[0];
  const path = first?.path.join(".") ?? "";
  const message = first?.message ?? "The request was not valid.";
  return { ok: false, error: path === "" ? message : `${path}: ${message}` };
}

/** A request to read an existing library from disk. */
export const readLibraryRequestSchema = z.object({
  libraryRoot: z.string().min(1),
});

/** Validated shape of a library read request. */
export type ReadLibraryRequest = z.infer<typeof readLibraryRequestSchema>;

/** A request to show a path in the system file browser. */
export const revealRequestSchema = z.object({
  path: z.string().min(1),
});

/** Validated shape of a reveal request. */
export type RevealRequest = z.infer<typeof revealRequestSchema>;
