import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);

describe("browsing", () => {
  let base: string;
  let root: string;
  let outside: string;
  let app: ReturnType<typeof createApp>;

  async function request(url: string): Promise<Response> {
    return app.request(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "stl-browse-")));
    root = join(base, "data");
    outside = join(base, "secret");
    await mkdir(join(root, "models", "terrain"), { recursive: true });
    await mkdir(join(root, "busts"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, "notes.txt"), "not a directory");

    const config: ServerConfig = { port: 8080, roots: [root], configDir: "/config" };
    app = createApp({ config, token: TOKEN, shareToken: SHARE_TOKEN, fs: new NodeFileSystem(), path: posixPath });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("lists the configured roots with labels", async () => {
    const body = await (await request("/api/roots")).json();
    expect(body).toEqual({ ok: true, value: [{ path: root, label: "data" }] });
  });

  it("lists only subdirectories, not files", async () => {
    const body = await (await request(`/api/directories?path=${encodeURIComponent(root)}`)).json();
    expect(body.value.map((entry: { name: string }) => entry.name)).toEqual(["busts", "models"]);
  });

  it("descends into a subdirectory", async () => {
    const path = encodeURIComponent(join(root, "models"));
    const body = await (await request(`/api/directories?path=${path}`)).json();
    expect(body.value.map((entry: { name: string }) => entry.name)).toEqual(["terrain"]);
  });

  it("returns an empty list for a directory with no subdirectories", async () => {
    const path = encodeURIComponent(join(root, "busts"));
    const body = await (await request(`/api/directories?path=${path}`)).json();
    expect(body).toEqual({ ok: true, value: [] });
  });

  it("refuses a path outside the roots", async () => {
    const response = await request(`/api/directories?path=${encodeURIComponent(outside)}`);
    expect(response.status).toBe(400);
  });

  it("refuses traversal out of a root", async () => {
    const path = encodeURIComponent(join(root, "..", "secret"));
    expect((await request(`/api/directories?path=${path}`)).status).toBe(400);
  });

  it("refuses a missing path parameter", async () => {
    expect((await request("/api/directories")).status).toBe(400);
  });

  it("refuses a path that does not exist", async () => {
    const path = encodeURIComponent(join(root, "nowhere"));
    expect((await request(`/api/directories?path=${path}`)).status).toBe(400);
  });

  it("does not list a symlinked directory pointing outside the roots", async () => {
    await symlink(outside, join(root, "escape"));
    const body = await (await request(`/api/directories?path=${encodeURIComponent(root)}`)).json();
    expect(body.value.map((entry: { name: string }) => entry.name)).not.toContain("escape");
  });

  it("hides dot directories", async () => {
    await mkdir(join(root, ".hidden"), { recursive: true });
    const body = await (await request(`/api/directories?path=${encodeURIComponent(root)}`)).json();
    expect(body.value.map((entry: { name: string }) => entry.name)).not.toContain(".hidden");
  });

  it("requires a token to browse", async () => {
    expect((await app.request("/api/roots")).status).toBe(401);
    expect((await app.request("/api/directories?path=/")).status).toBe(401);
  });
});
