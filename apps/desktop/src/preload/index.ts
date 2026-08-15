import electron from "electron";

const { contextBridge, ipcRenderer } = electron;
import { IPC_CHANNEL, type ProgressEvent } from "../shared/ipc.js";

/**
 * The complete surface the renderer is given.
 *
 * Nothing else crosses the boundary: no Node APIs, no filesystem, no direct
 * access to the engine. Every capability the interface has is listed here.
 */
const api = {
  chooseDirectory: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNEL.CHOOSE_DIRECTORY),
  buildPlan: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNEL.BUILD_PLAN, request),
  applyPlan: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNEL.APPLY_PLAN, request),
  listRuns: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNEL.LIST_RUNS, request),
  undoRun: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNEL.UNDO_RUN, request),
  readLibrary: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNEL.READ_LIBRARY, request),
  revealInFinder: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNEL.REVEAL_IN_FINDER, request),
  onProgress: (handler: (progress: ProgressEvent) => void): (() => void) => {
    const listener = (_event: unknown, progress: ProgressEvent): void => {
      handler(progress);
    };
    ipcRenderer.on(IPC_CHANNEL.PROGRESS, listener);
    return () => {
      ipcRenderer.off(IPC_CHANNEL.PROGRESS, listener);
    };
  },
};

contextBridge.exposeInMainWorld("stlManager", api);
