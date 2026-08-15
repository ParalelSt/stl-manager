import {
  applyPlanRequestSchema,
  buildPlanRequestSchema,
  JOB_KIND,
  JOB_STATE,
  parseRequest,
  PROGRESS_KIND,
  undoRunRequestSchema,
  type ApplyPlanRequest,
} from "@stl-manager/contracts";
import {
  apply,
  Journal,
  plan,
  readLibraryTree,
  undo,
  type FileSystem,
  type PathUtil,
  type PlannedMove,
} from "@stl-manager/core";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ApplyLock } from "../applyLock.js";
import type { JobRegistry } from "../jobs.js";
import type { PathGuard } from "../pathGuard.js";

/** What the work routes need. */
export interface WorkOptions {
  guard: PathGuard;
  jobs: JobRegistry;
  lock: ApplyLock;
  fs: FileSystem;
  path: PathUtil;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks every path in an apply request.
 *
 * The moves come from the client, which has been editing them. Without this,
 * the plan editor would be a way to write anywhere the server can reach, so
 * both ends of every move are confined: sources must really exist inside the
 * roots, and destinations must sit inside the library.
 */
async function confineMoves(
  moves: ApplyPlanRequest["moves"],
  libraryRoot: string,
  guard: PathGuard,
): Promise<PlannedMove[]> {
  const confined: PlannedMove[] = [];
  for (const move of moves) {
    const from = await guard.resolve(move.from);
    const to = guard.confineNew(move.to, libraryRoot);
    confined.push({ ...move, from, to });
  }
  return confined;
}

/**
 * The routes that do real work.
 *
 * Each starts a job and answers immediately with its identifier. Progress is
 * watched separately and the result is collected separately, so a dropped
 * connection costs the client its view of the work rather than the work.
 *
 * @param options - The guard, job registry, lock, and filesystem
 * @returns The routes, to be mounted under /api
 */
export function workRoutes(options: WorkOptions): Hono {
  const { guard, jobs, lock, fs, path } = options;
  const routes = new Hono();

  routes.post("/scans", async (context) => {
    const parsed = parseRequest(buildPlanRequestSchema, await context.req.json().catch(() => null));
    if (!parsed.ok) {
      return context.json({ ok: false, error: parsed.error }, 400);
    }

    let roots: string[];
    let libraryRoot: string;
    try {
      roots = await Promise.all(parsed.value.roots.map((root) => guard.resolve(root)));
      libraryRoot = await guard.resolve(parsed.value.libraryRoot);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    const jobId = jobs.start(JOB_KIND.SCAN, (report) =>
      plan({
        fs,
        path,
        roots,
        libraryRoot,
        onProgress: (done, currentPath) => {
          report({ kind: PROGRESS_KIND.SCAN, done, total: undefined, currentPath });
        },
      }),
    );

    return context.json({ ok: true, value: { jobId } }, 202);
  });

  routes.post("/applies", async (context) => {
    const parsed = parseRequest(applyPlanRequestSchema, await context.req.json().catch(() => null));
    if (!parsed.ok) {
      return context.json({ ok: false, error: parsed.error }, 400);
    }

    let libraryRoot: string;
    let moves: PlannedMove[];
    try {
      libraryRoot = await guard.resolve(parsed.value.libraryRoot);
      moves = await confineMoves(parsed.value.moves, libraryRoot, guard);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    const holder = lock.heldBy(libraryRoot);
    if (holder !== undefined) {
      return context.json(
        { ok: false, error: `Another run is already working on this library (job ${holder}).` },
        409,
      );
    }

    const runId = crypto.randomUUID();
    const jobId = jobs.start(JOB_KIND.APPLY, (report) =>
      lock.withLock(libraryRoot, runId, async () => {
        const result = await apply({
          fs,
          path,
          plan: { libraryRoot, scanRoots: [], moves, groups: [], untouched: [], problems: [] },
          journal: new Journal(fs, path, libraryRoot),
          runId,
          onProgress: (done, total, currentPath) => {
            report({ kind: PROGRESS_KIND.APPLY, done, total, currentPath });
          },
        });
        return { ...result, runId };
      }),
    );

    return context.json({ ok: true, value: { jobId } }, 202);
  });

  routes.post("/undos", async (context) => {
    const parsed = parseRequest(undoRunRequestSchema, await context.req.json().catch(() => null));
    if (!parsed.ok) {
      return context.json({ ok: false, error: parsed.error }, 400);
    }

    let libraryRoot: string;
    try {
      libraryRoot = await guard.resolve(parsed.value.libraryRoot);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    const holder = lock.heldBy(libraryRoot);
    if (holder !== undefined) {
      return context.json(
        { ok: false, error: `Another run is already working on this library (job ${holder}).` },
        409,
      );
    }

    const { runId } = parsed.value;
    const jobId = jobs.start(JOB_KIND.UNDO, (report) =>
      lock.withLock(libraryRoot, runId, () =>
        undo({
          fs,
          path,
          journal: new Journal(fs, path, libraryRoot),
          runId,
          onProgress: (done, total, currentPath) => {
            report({ kind: PROGRESS_KIND.UNDO, done, total, currentPath });
          },
        }),
      ),
    );

    return context.json({ ok: true, value: { jobId } }, 202);
  });

  routes.get("/runs", async (context) => {
    const requested = context.req.query("libraryRoot");
    if (requested === undefined || requested === "") {
      return context.json({ ok: false, error: "A libraryRoot is required." }, 400);
    }
    try {
      const libraryRoot = await guard.resolve(requested);
      const journal = new Journal(fs, path, libraryRoot);
      return context.json({ ok: true, value: await journal.listRuns() });
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }
  });

  routes.get("/library", async (context) => {
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

  routes.get("/jobs/:id", (context) => {
    const job = jobs.get(context.req.param("id"));
    if (job === undefined) {
      return context.json({ ok: false, error: "No such job." }, 404);
    }
    return context.json({ ok: true, value: job });
  });

  routes.get("/jobs/:id/events", (context) => {
    const id = context.req.param("id");
    if (jobs.get(id) === undefined) {
      return context.json({ ok: false, error: "No such job." }, 404);
    }

    return streamSSE(context, async (stream) => {
      const queue: string[] = [];
      let notify: (() => void) | undefined;

      const unsubscribe = jobs.subscribe(id, (progress) => {
        queue.push(JSON.stringify(progress));
        notify?.();
      });

      try {
        for (;;) {
          while (queue.length > 0) {
            const data = queue.shift();
            if (data !== undefined) {
              await stream.writeSSE({ event: "progress", data });
            }
          }

          const job = jobs.get(id);
          if (job === undefined || job.state !== JOB_STATE.RUNNING) {
            await stream.writeSSE({ event: "done", data: JSON.stringify({ id }) });
            return;
          }

          // Wake on the next progress report, or periodically so the loop can
          // notice the job finishing without one.
          await new Promise<void>((resolve) => {
            notify = resolve;
            setTimeout(resolve, 250);
          });
          notify = undefined;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return routes;
}
