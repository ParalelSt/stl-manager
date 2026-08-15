import type { OperationResult } from "@stl-manager/contracts";
import type { Transport } from "@stl-manager/ui";

/**
 * The bridge the preload script exposes.
 *
 * Typed here rather than in the shared interface package, because it is
 * specific to running inside Electron.
 */
declare global {
  interface Window {
    stlManager: Transport & {
      chooseDirectory: () => Promise<OperationResult<string | undefined>>;
    };
  }
}

/** Talks to the engine over Electron's IPC channel. */
export const ipcTransport: Transport = {
  listRoots: () => window.stlManager.listRoots(),
  listDirectories: (request) => window.stlManager.listDirectories(request),
  buildPlan: (request) => window.stlManager.buildPlan(request),
  applyPlan: (request) => window.stlManager.applyPlan(request),
  listRuns: (request) => window.stlManager.listRuns(request),
  undoRun: (request) => window.stlManager.undoRun(request),
  readLibrary: (request) => window.stlManager.readLibrary(request),
  revealInFinder: (request) => window.stlManager.revealInFinder(request),
  onProgress: (handler) => window.stlManager.onProgress(handler),
};

/** Opens the operating system's own folder chooser. */
export function chooseDirectoryViaDialog(): Promise<OperationResult<string | undefined>> {
  return window.stlManager.chooseDirectory();
}
