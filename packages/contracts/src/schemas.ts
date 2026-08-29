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
  LIST_ROOTS: "listRoots",
  LIST_DIRECTORIES: "listDirectories",
  PROGRESS: "progress",
} as const;

/** One of the operation names. */
export type IpcChannel = (typeof IPC_CHANNEL)[keyof typeof IPC_CHANNEL];

/**
 * The library layouts a scan can be asked for.
 *
 * Spelled out rather than imported from the engine, which this package does not
 * depend on, in the same way move reasons are below. The engine owns the
 * meaning; this owns only what is accepted over a transport.
 */
export const sortingProfileSchema = z.enum(["family", "name", "source", "type"]);

/**
 * A scan and plan request.
 *
 * The layout is optional, so a client that predates it still gets the default
 * rather than a rejected request.
 */
export const buildPlanRequestSchema = z.object({
  roots: z.array(z.string().min(1)).min(1),
  libraryRoot: z.string().min(1),
  profile: sortingProfileSchema.default("family"),
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

/** A mounted volume, or a starting point, the server is permitted to read. */
export interface RootInfo {
  /** The path as the server sees it, for example "/data/models". */
  path: string;
  /** A short label for the interface, derived from the last path segment. */
  label: string;
}

/** One subdirectory returned by the directory browser. */
export interface DirectoryEntry {
  name: string;
  path: string;
}

/** A request to list the subdirectories of a path. */
export const listDirectoriesRequestSchema = z.object({
  path: z.string().min(1),
});

/** Validated shape of a directory listing request. */
export type ListDirectoriesRequest = z.infer<typeof listDirectoriesRequestSchema>;

/**
 * The result of an operation, carrying either a value or a reason it failed.
 *
 * Operations do not throw across a transport boundary: an unhandled rejection
 * loses the message over IPC, and becomes an opaque 500 over HTTP. Returning
 * the reason means the interface can always say what went wrong.
 */
export type OperationResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: string };
