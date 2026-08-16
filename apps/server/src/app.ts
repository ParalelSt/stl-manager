import type { FileSystem, PathUtil } from "@stl-manager/core";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { ServerConfig } from "./config.js";
import type { JobRegistry } from "./jobs.js";
import { createApplyLock } from "./applyLock.js";
import { createJobRegistry } from "./jobs.js";
import { createPathGuard } from "./pathGuard.js";
import { browseRoutes } from "./routes/browse.js";
import { workRoutes } from "./routes/work.js";
import { isTokenValid } from "./token.js";

/** Everything the application needs, supplied rather than read from anywhere. */
export interface AppOptions {
  config: ServerConfig;
  token: string;
  /** The read-only token paired machines present. */
  shareToken: string;
  fs: FileSystem;
  path: PathUtil;
  /** Supplied by tests that need to inspect or control jobs. */
  jobs?: JobRegistry;
  /** Where the built interface lives. Omit to serve no interface at all. */
  webRoot?: string;
}

/** The prefix every authenticated route sits under. */
const API_PREFIX = "/api";

const BEARER = "Bearer ";

function suppliedToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith(BEARER)) {
    return "";
  }
  return header.slice(BEARER.length).trim();
}

/**
 * Builds the server application.
 *
 * Dependencies are arguments rather than module-level state, so a test can
 * construct an application with an in-memory filesystem and drive it without
 * opening a socket.
 *
 * @param options - Configuration, the token, and the filesystem to work through
 * @returns The application, ready to serve or to test
 */
export function createApp(options: AppOptions): Hono {
  const app = new Hono();

  // Liveness needs no secret, so a container healthcheck does not have to hold
  // one and cannot leak it into process listings.
  app.get("/health", (context) => context.json({ ok: true }));

  // Share routes accept either token. The owner can obviously read their own
  // machine, and a paired machine may read only through here.
  app.use(`${API_PREFIX}/share/*`, async (context, next) => {
    const supplied = suppliedToken(context.req.header("Authorization"));
    const isAllowed =
      isTokenValid(supplied, options.shareToken) || isTokenValid(supplied, options.token);
    if (!isAllowed) {
      return context.json({ ok: false, error: "Not authorised." }, 401);
    }
    await next();
    return undefined;
  });

  // Everything else requires the machine's own token. A share token reaching
  // one of these would let a paired machine reorganise this library, which is
  // the whole reason the two are separate.
  app.use(`${API_PREFIX}/*`, async (context, next) => {
    if (context.req.path.startsWith(`${API_PREFIX}/share/`)) {
      await next();
      return undefined;
    }
    const supplied = suppliedToken(context.req.header("Authorization"));
    if (!isTokenValid(supplied, options.token)) {
      // Deliberately says nothing about why, so a refusal cannot be used to
      // learn anything about the expected token.
      return context.json({ ok: false, error: "Not authorised." }, 401);
    }
    await next();
    return undefined;
  });

  const guard = createPathGuard(options.config.roots);
  const jobs = options.jobs ?? createJobRegistry();
  const lock = createApplyLock();

  app.route(API_PREFIX, browseRoutes({ guard, fs: options.fs, path: options.path }));
  app.route(API_PREFIX, workRoutes({ guard, jobs, lock, fs: options.fs, path: options.path }));

  // Anything under /api that reached this far is a real miss. Answering with
  // the interface's HTML instead would surface as a confusing JSON parse
  // failure in the client rather than an honest 404.
  app.all(`${API_PREFIX}/*`, (context) =>
    context.json({ ok: false, error: "No such endpoint." }, 404),
  );

  const webRoot = options.webRoot;
  if (webRoot !== undefined) {
    app.use("/*", serveStatic({ root: webRoot }));
    // The interface routes on the client, so an unknown path is its business.
    app.get("/*", serveStatic({ path: "index.html", root: webRoot }));
  }

  return app;
}
