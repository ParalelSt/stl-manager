import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import electron, { app } from "electron";
import { randomUUID } from "node:crypto";
import {
  createShareRegistry,
  DEFAULT_EXPIRY_MS,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  type SharedFile,
} from "@stl-manager/server";

const { ipcMain } = electron;
const fs = new NodeFileSystem();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Registers share management for the desktop application.
 *
 * The desktop app can make and revoke shares, and they are stored the same way
 * the server stores them. It cannot serve them: a link is only reachable while
 * a server is running, which the documentation says plainly.
 */
export function registerShareHandlers(): void {
  const shares = () => createShareRegistry(fs, posixPath, app.getPath("userData"));

  ipcMain.handle("listShares", async () => {
    const all = await shares().list();
    return {
      ok: true,
      value: all.map((share) => ({
        id: share.id,
        label: share.label,
        token: share.token,
        fileCount: share.files.length,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
        allowsUpload: share.allowsUpload,
        uploadedBytes: share.uploadedBytes,
      })),
    };
  });

  ipcMain.handle("createShare", async (_event, request: unknown) => {
    const record: Record<string, unknown> =
      typeof request === "object" && request !== null ? { ...request } : {};
    const paths = record["paths"];
    if (!Array.isArray(paths) || paths.length === 0) {
      return { ok: false, error: "At least one file is required." };
    }

    const files: SharedFile[] = [];
    for (const entry of paths) {
      if (typeof entry !== "string") {
        continue;
      }
      try {
        const stats = await fs.stat(entry);
        files.push({
          id: randomUUID(),
          path: entry,
          name: entry.slice(entry.lastIndexOf("/") + 1),
          size: stats.size,
        });
      } catch (error) {
        return { ok: false, error: describeError(error) };
      }
    }

    const label = record["label"];
    const expiresInMs = record["expiresInMs"];
    const created = await shares().create({
      label: typeof label === "string" && label !== "" ? label : "Shared files",
      files,
      expiresAt:
        expiresInMs === null
          ? undefined
          : Date.now() + (typeof expiresInMs === "number" ? expiresInMs : DEFAULT_EXPIRY_MS),
      allowsUpload: record["allowsUpload"] === true,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    });

    return { ok: true, value: { id: created.id, token: created.token } };
  });

  ipcMain.handle("revokeShare", async (_event, id: unknown) => {
    if (typeof id !== "string") {
      return { ok: false, error: "A share is required." };
    }
    await shares().revoke(id);
    return { ok: true, value: undefined };
  });
}
