import type {
  ApplyResult,
  RunSummary,
  SortPlan,
  TreeFolder,
  UndoResult,
} from "@stl-manager/core";
import type {
  ApplyPlanRequest,
  BuildPlanRequest,
  ListRunsRequest,
  OperationResult,
  ProgressEvent,
  ReadLibraryRequest,
  RevealRequest,
  UndoRunRequest,
} from "@stl-manager/contracts";

/** An apply result, plus the run identifier undo will need. */
export interface AppliedRun extends ApplyResult {
  runId: string;
}

/**
 * Everything the interface is allowed to do.
 *
 * The renderer has no filesystem access and no knowledge of the engine. This
 * is its entire capability list, which is what makes replacing the transport
 * in a later phase a contained change.
 */
export interface StlManagerApi {
  chooseDirectory(): Promise<OperationResult<string | undefined>>;
  buildPlan(request: BuildPlanRequest): Promise<OperationResult<SortPlan>>;
  applyPlan(request: ApplyPlanRequest): Promise<OperationResult<AppliedRun>>;
  listRuns(request: ListRunsRequest): Promise<OperationResult<RunSummary[]>>;
  undoRun(request: UndoRunRequest): Promise<OperationResult<UndoResult>>;
  readLibrary(request: ReadLibraryRequest): Promise<OperationResult<TreeFolder>>;
  revealInFinder(request: RevealRequest): Promise<OperationResult<undefined>>;
  /** Subscribes to progress events. Returns a function that unsubscribes. */
  onProgress(handler: (progress: ProgressEvent) => void): () => void;
}

declare global {
  interface Window {
    stlManager: StlManagerApi;
  }
}

/**
 * The bridge exposed by the preload script.
 *
 * Reading it through a single accessor keeps the global off every component
 * and gives tests one thing to replace.
 */
export function bridge(): StlManagerApi {
  return window.stlManager;
}
