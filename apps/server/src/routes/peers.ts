import { JOB_KIND, type OperationResult } from "@stl-manager/contracts";
import type { FileSystem, PathUtil, TreeFolder } from "@stl-manager/core";
import { Hono } from "hono";
import type { JobRegistry } from "../jobs.js";
import type { PathGuard } from "../pathGuard.js";
import type { Peer, PeerRegistry } from "../peers.js";
import { pullFromPeer, type PullResult } from "../pull.js";

/** What the peer routes need. */
export interface PeerOptions {
  peers: PeerRegistry;
  guard: PathGuard;
  jobs: JobRegistry;
  fs: FileSystem;
  path: PathUtil;
  /** Injected so tests can wire one server straight to another. */
  fetch?: typeof globalThis.fetch;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Asks a peer for its catalogue.
 *
 * Also serves as the check that a pairing is real: a wrong token or a wrong
 * address fails here, at the moment the user makes the mistake, rather than
 * later when they try to use it.
 */
async function fetchCatalogue(
  peer: Pick<Peer, "baseUrl" | "shareToken" | "libraryRoot">,
  doFetch: typeof globalThis.fetch,
): Promise<TreeFolder> {
  const url = `${peer.baseUrl}/api/share/catalogue?libraryRoot=${encodeURIComponent(peer.libraryRoot)}`;
  const response = await doFetch(url, {
    headers: { Authorization: `Bearer ${peer.shareToken}` },
  });
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return Promise.reject(new Error(`That machine answered with status ${response.status}.`));
  }
  const result = body as OperationResult<TreeFolder>;
  if (!result.ok) {
    return Promise.reject(new Error(result.error));
  }
  return result.value;
}

/**
 * Routes for working with other machines.
 *
 * All of these need this machine's own token: they are the owner acting, not a
 * peer. The only routes a peer itself may reach are under /api/share.
 *
 * @param options - The registry, guard, jobs and filesystem
 * @returns The routes, to be mounted under /api
 */
export function peerRoutes(options: PeerOptions): Hono {
  const { peers, guard, jobs, fs, path } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  const routes = new Hono();

  routes.get("/peers", async (context) => {
    const known = await peers.list();
    // The share tokens are not sent to the interface: it never needs them, and
    // a screen that displays them is a screen someone screenshots.
    return context.json({
      ok: true,
      value: known.map(({ shareToken: _shareToken, ...rest }) => rest),
    });
  });

  routes.post("/peers", async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    if (typeof body !== "object" || body === null) {
      return context.json({ ok: false, error: "A peer is required." }, 400);
    }
    const record: Record<string, unknown> = { ...body };
    const baseUrl = record["baseUrl"];
    const shareToken = record["shareToken"];
    const libraryRoot = record["libraryRoot"];
    const label = record["label"];

    if (
      typeof baseUrl !== "string" ||
      baseUrl === "" ||
      typeof shareToken !== "string" ||
      shareToken === "" ||
      typeof libraryRoot !== "string" ||
      libraryRoot === ""
    ) {
      return context.json(
        { ok: false, error: "An address, a share token and a library are all required." },
        400,
      );
    }

    const candidate = { baseUrl, shareToken, libraryRoot };
    try {
      await fetchCatalogue(candidate, doFetch);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    const added = await peers.add({
      ...candidate,
      label: typeof label === "string" && label !== "" ? label : baseUrl,
    });
    const { shareToken: _hidden, ...safe } = added;
    return context.json({ ok: true, value: safe }, 201);
  });

  routes.delete("/peers/:id", async (context) => {
    await peers.remove(context.req.param("id"));
    return context.json({ ok: true, value: undefined });
  });

  routes.get("/peers/:id/catalogue", async (context) => {
    const peer = await peers.get(context.req.param("id"));
    if (peer === undefined) {
      return context.json({ ok: false, error: "No such peer." }, 404);
    }
    try {
      return context.json({ ok: true, value: await fetchCatalogue(peer, doFetch) });
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }
  });

  routes.post("/peers/:id/pulls", async (context) => {
    const peer = await peers.get(context.req.param("id"));
    if (peer === undefined) {
      return context.json({ ok: false, error: "No such peer." }, 404);
    }

    const body: unknown = await context.req.json().catch(() => null);
    const record: Record<string, unknown> = typeof body === "object" && body !== null ? { ...body } : {};
    const paths = record["paths"];
    const stagingDir = record["stagingDir"];

    if (!Array.isArray(paths) || paths.some((entry) => typeof entry !== "string")) {
      return context.json({ ok: false, error: "A list of paths is required." }, 400);
    }
    if (typeof stagingDir !== "string" || stagingDir === "") {
      return context.json({ ok: false, error: "A staging folder is required." }, 400);
    }

    let staging: string;
    try {
      staging = await guard.resolve(stagingDir);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    const jobId = jobs.start(JOB_KIND.SCAN, (report): Promise<PullResult> =>
      pullFromPeer({
        peer,
        paths: paths.filter((entry): entry is string => typeof entry === "string"),
        stagingDir: staging,
        fs,
        path,
        fetch: doFetch,
        onProgress: report,
      }),
    );

    return context.json({ ok: true, value: { jobId } }, 202);
  });

  return routes;
}
