import { randomUUID } from "node:crypto";
import {
  apply,
  Journal,
  plan,
  posixPath,
  readLibraryTree,
  undo,
  type ApplyResult,
  type RunSummary,
  type SortPlan,
  type TreeFolder,
  type UndoResult,
} from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import electron, { type IpcMainInvokeEvent } from "electron";
import {
  applyPlanRequestSchema,
  buildPlanRequestSchema,
  IPC_CHANNEL,
  listRunsRequestSchema,
  parseRequest,
  PROGRESS_KIND,
  readLibraryRequestSchema,
  revealRequestSchema,
  undoRunRequestSchema,
  type ProgressEvent,
} from "../shared/ipc.js";

const { dialog, ipcMain, shell } = electron;

const fs = new NodeFileSystem();

/** The result of an operation, carrying either a value or a reason it failed. */
export type OperationResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: string };

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function reportProgress(event: IpcMainInvokeEvent, progress: ProgressEvent): void {
  if (event.sender.isDestroyed()) {
    return;
  }
  event.sender.send(IPC_CHANNEL.PROGRESS, progress);
}

/**
 * Registers every operation the renderer can invoke.
 *
 * Each handler validates its request before the engine sees it, because IPC is
 * the only place untrusted input enters the main process. A handler never
 * throws across the boundary: failures come back as a result the renderer can
 * render, since an unhandled rejection in Electron IPC loses the message.
 */
export function registerHandlers(): void {
  ipcMain.handle(IPC_CHANNEL.CHOOSE_DIRECTORY, async (): Promise<
    OperationResult<string | undefined>
  > => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) {
      return { ok: true, value: undefined };
    }
    return { ok: true, value: result.filePaths[0] };
  });

  ipcMain.handle(
    IPC_CHANNEL.BUILD_PLAN,
    async (event, request: unknown): Promise<OperationResult<SortPlan>> => {
      const parsed = parseRequest(buildPlanRequestSchema, request);
      if (!parsed.ok) {
        return parsed;
      }

      try {
        const built = await plan({
          fs,
          path: posixPath,
          roots: parsed.value.roots,
          libraryRoot: parsed.value.libraryRoot,
          onProgress: (count, currentPath) => {
            reportProgress(event, {
              kind: PROGRESS_KIND.SCAN,
              done: count,
              total: undefined,
              currentPath,
            });
          },
        });
        return { ok: true, value: built };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNEL.APPLY_PLAN,
    async (
      event,
      request: unknown,
    ): Promise<OperationResult<ApplyResult & { runId: string }>> => {
      const parsed = parseRequest(applyPlanRequestSchema, request);
      if (!parsed.ok) {
        return parsed;
      }

      const { libraryRoot, moves } = parsed.value;
      const runId = randomUUID();

      try {
        const result = await apply({
          fs,
          path: posixPath,
          // Applying needs only the moves; the scan roots mattered when the
          // destinations were derived, which has already happened.
          plan: { libraryRoot, scanRoots: [], moves, groups: [], untouched: [], problems: [] },
          journal: new Journal(fs, posixPath, libraryRoot),
          runId,
          onProgress: (done, total, currentPath) => {
            reportProgress(event, { kind: PROGRESS_KIND.APPLY, done, total, currentPath });
          },
        });
        return { ok: true, value: { ...result, runId } };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNEL.LIST_RUNS,
    async (_event, request: unknown): Promise<OperationResult<RunSummary[]>> => {
      const parsed = parseRequest(listRunsRequestSchema, request);
      if (!parsed.ok) {
        return parsed;
      }

      try {
        const journal = new Journal(fs, posixPath, parsed.value.libraryRoot);
        return { ok: true, value: await journal.listRuns() };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNEL.READ_LIBRARY,
    async (_event, request: unknown): Promise<OperationResult<TreeFolder>> => {
      const parsed = parseRequest(readLibraryRequestSchema, request);
      if (!parsed.ok) {
        return parsed;
      }
      try {
        return { ok: true, value: await readLibraryTree(fs, posixPath, parsed.value.libraryRoot) };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNEL.REVEAL_IN_FINDER,
    async (_event, request: unknown): Promise<OperationResult<undefined>> => {
      const parsed = parseRequest(revealRequestSchema, request);
      if (!parsed.ok) {
        return parsed;
      }
      shell.showItemInFolder(parsed.value.path);
      return { ok: true, value: undefined };
    },
  );

  ipcMain.handle(
    IPC_CHANNEL.UNDO_RUN,
    async (event, request: unknown): Promise<OperationResult<UndoResult>> => {
      const parsed = parseRequest(undoRunRequestSchema, request);
      if (!parsed.ok) {
        return parsed;
      }

      try {
        const result = await undo({
          fs,
          path: posixPath,
          journal: new Journal(fs, posixPath, parsed.value.libraryRoot),
          runId: parsed.value.runId,
          onProgress: (done, total, currentPath) => {
            reportProgress(event, { kind: PROGRESS_KIND.UNDO, done, total, currentPath });
          },
        });
        return { ok: true, value: result };
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    },
  );
}
