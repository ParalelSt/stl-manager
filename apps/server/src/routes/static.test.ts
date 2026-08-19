import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);

describe("serving the interface", () => {
  let base: string;
  let webRoot: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    base = await mkdtemp("/tmp/stl-static-");
    webRoot = join(base, "web");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>STL Manager</title>");
    await writeFile(join(webRoot, "assets", "index.css"), "body{}");

    const config: ServerConfig = { port: 8080, roots: [base], configDir: "/config", dropDir: "/config/drops", trustProxy: false, host: "127.0.0.1", isRemote: false };
    app = createApp({
      config,
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new NodeFileSystem(),
      path: posixPath,
      webRoot,
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("serves the interface at the root", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("STL Manager");
  });

  it("serves assets", async () => {
    expect((await app.request("/assets/index.css")).status).toBe(200);
  });

  it("returns the interface for an unknown path so client routing works", async () => {
    const response = await app.request("/history");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("STL Manager");
  });

  it("does not serve the interface under /api", async () => {
    const response = await app.request("/api/nonsense", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<!doctype html>");
  });

  it("still requires a token for api routes", async () => {
    expect((await app.request("/api/roots")).status).toBe(401);
  });

  it("serves no interface when none is configured", async () => {
    const bare = createApp({
      config: { port: 8080, roots: [base], configDir: "/config", dropDir: "/config/drops", trustProxy: false, host: "127.0.0.1", isRemote: false },
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new NodeFileSystem(),
      path: posixPath,
    });
    expect((await bare.request("/")).status).toBe(404);
  });
});
