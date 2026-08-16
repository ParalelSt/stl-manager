import { Hono } from "hono";
import type { FileSystem, PathUtil } from "@stl-manager/core";
import type { PathGuard } from "../pathGuard.js";
import {
  DEFAULT_EXPIRY_MS,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  type ShareRegistry,
  type SharedFile,
} from "../shares.js";
import { randomUUID } from "node:crypto";

/** What the owner-facing share routes need. */
export interface ShareAdminOptions {
  shares: ShareRegistry;
  guard: PathGuard;
  fs: FileSystem;
  path: PathUtil;
  now?: () => number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Routes for making and revoking shares.
 *
 * These need the machine's own token. The link itself is the only thing anyone
 * else ever holds, and it reaches nothing here.
 *
 * @param options - The registry, guard and filesystem
 * @returns The routes, to be mounted under /api
 */
export function shareAdminRoutes(options: ShareAdminOptions): Hono {
  const { shares, guard, fs, path } = options;
  const now = options.now ?? Date.now;
  const routes = new Hono();

  routes.get("/shares", async (context) => {
    const all = await shares.list();
    return context.json({
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
    });
  });

  routes.post("/shares", async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const record: Record<string, unknown> =
      typeof body === "object" && body !== null ? { ...body } : {};

    const paths = record["paths"];
    const label = record["label"];
    const allowsUpload = record["allowsUpload"] === true;
    const expiresInMs = record["expiresInMs"];

    if (!Array.isArray(paths) || paths.length === 0) {
      return context.json({ ok: false, error: "At least one file is required." }, 400);
    }

    const files: SharedFile[] = [];
    for (const entry of paths) {
      if (typeof entry !== "string") {
        return context.json({ ok: false, error: "Every path must be a string." }, 400);
      }
      try {
        const resolved = await guard.resolve(entry);
        const stats = await fs.stat(resolved);
        files.push({
          id: randomUUID(),
          path: resolved,
          name: path.basename(resolved),
          size: stats.size,
        });
      } catch (error) {
        return context.json({ ok: false, error: describeError(error) }, 400);
      }
    }

    // Every share expires unless an unlimited one is asked for explicitly: a
    // link that lives forever is a link that leaks eventually.
    const expiry =
      expiresInMs === null
        ? undefined
        : now() + (typeof expiresInMs === "number" && expiresInMs > 0 ? expiresInMs : DEFAULT_EXPIRY_MS);

    const created = await shares.create({
      label: typeof label === "string" && label !== "" ? label : "Shared files",
      files,
      expiresAt: expiry,
      allowsUpload,
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    });

    return context.json(
      { ok: true, value: { id: created.id, token: created.token, expiresAt: created.expiresAt } },
      201,
    );
  });

  routes.delete("/shares/:id", async (context) => {
    await shares.revoke(context.req.param("id"));
    return context.json({ ok: true, value: undefined });
  });

  return routes;
}
