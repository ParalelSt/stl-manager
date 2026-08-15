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
import { createContext, createElement, useContext, type ReactNode } from "react";

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

const HostContext = createContext<Host | undefined>(undefined);

/** Supplies the interface with everything it needs from its surroundings. */
export function HostProvider({ host, children }: { host: Host; children: ReactNode }) {
  return createElement(HostContext.Provider, { value: host }, children);
}

/**
 * Reads the host the interface is running inside.
 *
 * @throws when used outside a HostProvider, which is otherwise a confusing
 *   failure deep inside an unrelated hook
 */
export function useHost(): Host {
  const host = useContext(HostContext);
  if (host === undefined) {
    throw new Error("useHost was called outside a HostProvider.");
  }
  return host;
}
