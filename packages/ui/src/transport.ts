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

/** A machine this one is paired with, as the interface sees it. */
export interface PeerSummary {
  id: string;
  label: string;
  baseUrl: string;
  libraryRoot: string;
}

/** What pairing with a machine needs. */
export interface PairRequest {
  baseUrl: string;
  shareToken: string;
  libraryRoot: string;
  label?: string;
}

/** What a pull needs. */
export interface PullRequest {
  peerId: string;
  stagingDir: string;
  paths: string[];
}

/** The outcome of pulling files from a peer. */
export interface PullOutcome {
  fetched: number;
  skipped: number;
  failed: { path: string; reason: string }[];
  stagingDir: string;
}

/** A share as the owner sees it. */
export interface ShareSummary {
  id: string;
  label: string;
  token: string;
  fileCount: number;
  createdAt: number;
  expiresAt: number | undefined;
  allowsUpload: boolean;
  uploadedBytes: number;
}

/** What making a share needs. */
export interface CreateShareRequest {
  paths: string[];
  label: string;
  allowsUpload: boolean;
  /** How long it lasts. Null for a share that never expires. */
  expiresInMs: number | null;
}

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
  listPeers(): Promise<OperationResult<PeerSummary[]>>;
  addPeer(request: PairRequest): Promise<OperationResult<PeerSummary>>;
  removePeer(id: string): Promise<OperationResult<undefined>>;
  peerCatalogue(id: string): Promise<OperationResult<TreeFolder>>;
  pullFromPeer(request: PullRequest): Promise<OperationResult<PullOutcome>>;
  listShares(): Promise<OperationResult<ShareSummary[]>>;
  createShare(request: CreateShareRequest): Promise<OperationResult<{ id: string; token: string }>>;
  revokeShare(id: string): Promise<OperationResult<undefined>>;
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
