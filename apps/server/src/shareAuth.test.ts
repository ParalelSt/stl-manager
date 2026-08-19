import { posixPath } from "@stl-manager/core";
import { MemoryFileSystem } from "@stl-manager/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);
const CONFIG: ServerConfig = { port: 8080, roots: ["/data"], configDir: "/config", dropDir: "/config/drops", trustProxy: false };

/**
 * The rule that makes a share token safe to hand to another machine.
 *
 * It may read, and it may do nothing else. If this ever passes on an ordinary
 * route, a paired machine can reorganise a library that is not its own.
 */
describe("share token authority", () => {
  let app: ReturnType<typeof createApp>;

  function withToken(path: string, token: string, method = "GET"): Promise<Response> {
    return app.request(path, { method, headers: { Authorization: `Bearer ${token}` } });
  }

  beforeEach(() => {
    app = createApp({
      config: CONFIG,
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new MemoryFileSystem({}),
      path: posixPath,
    });
  });

  it("refuses a share token on every ordinary api route", async () => {
    for (const path of ["/api/roots", "/api/directories?path=/data", "/api/runs?libraryRoot=/data"]) {
      expect((await withToken(path, SHARE_TOKEN)).status).toBe(401);
    }
  });

  it("refuses a share token on the routes that change things", async () => {
    for (const path of ["/api/scans", "/api/applies", "/api/undos"]) {
      expect((await withToken(path, SHARE_TOKEN, "POST")).status).toBe(401);
    }
  });

  it("still accepts the machine token on ordinary routes", async () => {
    expect((await withToken("/api/roots", TOKEN)).status).toBe(200);
  });

  it("refuses an unknown token everywhere", async () => {
    const wrong = "z".repeat(64);
    expect((await withToken("/api/roots", wrong)).status).toBe(401);
    expect((await withToken("/api/share/catalogue?libraryRoot=/data", wrong)).status).toBe(401);
  });

  it("refuses a missing token on a share route", async () => {
    expect((await app.request("/api/share/catalogue?libraryRoot=/data")).status).toBe(401);
  });
});
