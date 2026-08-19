import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);

describe("share routes", () => {
  let base: string;
  let root: string;
  let library: string;
  let elsewhere: string;
  let app: ReturnType<typeof createApp>;

  function share(path: string): Promise<Response> {
    return app.request(path, { headers: { Authorization: `Bearer ${SHARE_TOKEN}` } });
  }

  beforeEach(async () => {
    base = await realpath(await mkdtemp("/tmp/stl-share-"));
    root = join(base, "data");
    library = join(root, "library");
    elsewhere = join(root, "downloads");
    await mkdir(join(library, "kit"), { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(library, "kit", "kit_base.stl"), "base-mesh-contents");
    await writeFile(join(elsewhere, "private.stl"), "not shared");

    const config: ServerConfig = { port: 8080, roots: [root], configDir: "/config", dropDir: "/config/drops", trustProxy: false };
    app = createApp({
      config,
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new NodeFileSystem(),
      path: posixPath,
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("serves the catalogue as a tree", async () => {
    const body = await (await share(`/api/share/catalogue?libraryRoot=${encodeURIComponent(library)}`)).json();
    expect(body.value.fileCount).toBe(1);
    expect(body.value.children[0].name).toBe("kit");
  });

  it("streams a file's bytes", async () => {
    const url = `/api/share/file?libraryRoot=${encodeURIComponent(library)}&path=${encodeURIComponent(join(library, "kit", "kit_base.stl"))}`;
    const response = await share(url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("base-mesh-contents");
    expect(response.headers.get("content-length")).toBe("18");
  });

  it("refuses a file inside the roots but outside the library", async () => {
    // The roots are wider than the library. A peer may read only the library.
    const url = `/api/share/file?libraryRoot=${encodeURIComponent(library)}&path=${encodeURIComponent(join(elsewhere, "private.stl"))}`;
    expect((await share(url)).status).toBe(400);
  });

  it("refuses a file reached by traversal out of the library", async () => {
    const escape = join(library, "..", "downloads", "private.stl");
    const url = `/api/share/file?libraryRoot=${encodeURIComponent(library)}&path=${encodeURIComponent(escape)}`;
    expect((await share(url)).status).toBe(400);
  });

  it("refuses a file reached through a symlink out of the library", async () => {
    await symlink(elsewhere, join(library, "escape"));
    const url = `/api/share/file?libraryRoot=${encodeURIComponent(library)}&path=${encodeURIComponent(join(library, "escape", "private.stl"))}`;
    expect((await share(url)).status).toBe(400);
  });

  it("refuses a path outside the roots entirely", async () => {
    const url = `/api/share/file?libraryRoot=${encodeURIComponent(library)}&path=${encodeURIComponent("/etc/passwd")}`;
    expect((await share(url)).status).toBe(400);
  });

  it("refuses a missing path", async () => {
    expect((await share(`/api/share/file?libraryRoot=${encodeURIComponent(library)}`)).status).toBe(400);
  });

  it("refuses a catalogue for a library outside the roots", async () => {
    expect((await share("/api/share/catalogue?libraryRoot=/etc")).status).toBe(400);
  });

  it("accepts the machine's own token as well", async () => {
    const response = await app.request(
      `/api/share/catalogue?libraryRoot=${encodeURIComponent(library)}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(response.status).toBe(200);
  });
});
