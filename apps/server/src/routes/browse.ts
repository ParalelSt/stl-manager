import type { DirectoryEntry } from "@stl-manager/contracts";
import type { FileSystem, PathUtil } from "@stl-manager/core";
import { Hono } from "hono";
import type { PathGuard } from "../pathGuard.js";

/** What the browsing routes need. */
export interface BrowseOptions {
  guard: PathGuard;
  fs: FileSystem;
  path: PathUtil;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Routes for finding your way around the folders the server may read.
 *
 * A browser has no native folder chooser, so this is how the interface offers
 * one. Every path goes through the guard first, which is what stops it being a
 * filesystem browser for the whole container.
 *
 * @param options - The guard and the filesystem to read through
 * @returns The routes, to be mounted under /api
 */
export function browseRoutes(options: BrowseOptions): Hono {
  const routes = new Hono();

  routes.get("/roots", (context) =>
    context.json({ ok: true, value: options.guard.roots() }),
  );

  routes.get("/directories", async (context) => {
    const requested = context.req.query("path");
    if (requested === undefined || requested === "") {
      return context.json({ ok: false, error: "A path is required." }, 400);
    }

    let directory: string;
    try {
      directory = await options.guard.resolve(requested);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    try {
      const entries = await options.fs.list(directory);
      const directories: DirectoryEntry[] = [];
      for (const entry of entries) {
        // Symlinks are skipped for the same reason the scanner skips them: a
        // link can point outside the roots, and following one here would let
        // the browser walk out of its confinement.
        if (!entry.isDirectory || entry.isSymbolicLink || entry.name.startsWith(".")) {
          continue;
        }
        directories.push({ name: entry.name, path: entry.path });
      }
      directories.sort((left, right) => left.name.localeCompare(right.name));
      return context.json({ ok: true, value: directories });
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }
  });

  return routes;
}
