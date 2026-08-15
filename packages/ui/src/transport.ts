import type {
  ApplyPlanRequest,
  BuildPlanRequest,
  DirectoryEntry,
  ListDirectoriesRequest,
  ListRunsRequest,
  OperationResult,
  ProgressEvent,
  ReadLibraryRequest,
  RevealRequest,
  RootInfo,
  UndoRunRequest,
} from "@stl-manager/contracts";
import type {
  ApplyResult,
  RunSummary,
  SortPlan,
  TreeFolder,
  UndoResult,
} from "@stl-manager/core";

/** An apply result, plus the run identifier undo will need. */
export interface AppliedRun extends ApplyResult {
  runId: string;
}

/**
 * Every data operation the interface can perform.
 *
 * The interface never reaches the engine or the filesystem itself. Supplying a
 * different implementation of this is the whole of what running the same
 * screens somewhere else requires.
 */
export interface Transport {
  listRoots(): Promise<OperationResult<RootInfo[]>>;
  listDirectories(request: ListDirectoriesRequest): Promise<OperationResult<DirectoryEntry[]>>;
  buildPlan(request: BuildPlanRequest): Promise<OperationResult<SortPlan>>;
  applyPlan(request: ApplyPlanRequest): Promise<OperationResult<AppliedRun>>;
  listRuns(request: ListRunsRequest): Promise<OperationResult<RunSummary[]>>;
  undoRun(request: UndoRunRequest): Promise<OperationResult<UndoResult>>;
  readLibrary(request: ReadLibraryRequest): Promise<OperationResult<TreeFolder>>;
  revealInFinder(request: RevealRequest): Promise<OperationResult<undefined>>;
  /** Subscribes to progress events. Returns a function that unsubscribes. */
  onProgress(handler: (progress: ProgressEvent) => void): () => void;
}

/** What the surrounding application supplies to the interface. */
export interface Host {
  transport: Transport;
  /**
   * Opens the platform's own folder chooser.
   *
   * Supplied by the desktop application so it keeps its native dialog. Where it
   * is absent, the interface falls back to its own directory browser, which is
   * what a browser build uses.
   */
  chooseDirectory?: () => Promise<OperationResult<string | undefined>>;
}
