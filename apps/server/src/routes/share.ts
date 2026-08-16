import type { FileSystem, PathUtil } from "@stl-manager/core";
import { readLibraryTree } from "@stl-manager/core";
import { Hono } from "hono";
import type { PathGuard } from "../pathGuard.js";

/** What the share routes need. */
export interface ShareOptions {
  guard: PathGuard;
  fs: FileSystem;
  path: PathUtil;
}

/** How much of a file is read at a time when streaming it to a peer. */
const CHUNK_BYTES = 1024 * 1024;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Confirms a path is inside the given library, not merely inside the roots.
 *
 * The configured roots are wider than the library: they also hold the folders
 * the user scans. A peer has no business reading those, so sharing is narrowed
 * to the library a second time.
 */
async function insideLibrary(
  requested: string,
  libraryRoot: string,
  guard: PathGuard,
  path: PathUtil,
): Promise<string> {
  const resolvedLibrary = await guard.resolve(libraryRoot);
  const resolved = await guard.resolve(requested);
  const library = path.segments(resolvedLibrary);
  const candidate = path.segments(resolved);
  const isInside = library.every((segment, index) => candidate[index] === segment);
  if (!isInside || candidate.length < library.length) {
    throw new Error("That path is not inside the shared library.");
  }
  return resolved;
}

/**
 * The only routes another machine may reach.
 *
 * Both are read-only, and that is the property the whole pairing design rests
 * on: a token that can reach these can do nothing else, so handing it to
 * another machine cannot cost you anything but privacy about what you own.
 *
 * @param options - The guard and filesystem to read through
 * @returns The routes, mounted under /api/share
 */
export function shareRoutes(options: ShareOptions): Hono {
  const { guard, fs, path } = options;
  const routes = new Hono();

  routes.get("/catalogue", async (context) => {
    const requested = context.req.query("libraryRoot");
    if (requested === undefined || requested === "") {
      return context.json({ ok: false, error: "A libraryRoot is required." }, 400);
    }
    try {
      const libraryRoot = await guard.resolve(requested);
      return context.json({ ok: true, value: await readLibraryTree(fs, path, libraryRoot) });
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }
  });

  routes.get("/file", async (context) => {
    const requested = context.req.query("path");
    const libraryRoot = context.req.query("libraryRoot");
    if (requested === undefined || libraryRoot === undefined) {
      return context.json({ ok: false, error: "A path and a libraryRoot are required." }, 400);
    }

    let resolved: string;
    let size: number;
    try {
      resolved = await insideLibrary(requested, libraryRoot, guard, path);
      const stats = await fs.stat(resolved);
      size = stats.size;
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    // Streamed rather than read whole: a mesh can be larger than it is
    // reasonable to hold in memory, and several peers may pull at once.
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        try {
          let offset = 0;
          while (offset < size) {
            const chunk = await fs.readChunk(resolved, offset, CHUNK_BYTES);
            if (chunk.length === 0) {
              break;
            }
            controller.enqueue(chunk);
            offset += chunk.length;
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(size),
      },
    });
  });

  return routes;
}
