import type { FileSystem, PathUtil } from "@stl-manager/core";
import { Hono } from "hono";
import type { ServerConfig } from "./config.js";
import { createPathGuard } from "./pathGuard.js";
import { browseRoutes } from "./routes/browse.js";
import { isTokenValid } from "./token.js";

/** Everything the application needs, supplied rather than read from anywhere. */
export interface AppOptions {
  config: ServerConfig;
  token: string;
  fs: FileSystem;
  path: PathUtil;
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

  app.use(`${API_PREFIX}/*`, async (context, next) => {
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
  app.route(API_PREFIX, browseRoutes({ guard, fs: options.fs, path: options.path }));

  return app;
}
