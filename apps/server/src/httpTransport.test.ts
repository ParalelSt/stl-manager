import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import type { Transport } from "@stl-manager/ui/transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import { createHttpTransport } from "./httpTransport.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);

/**
 * Driven against a real application rather than a mocked fetch.
 *
 * The thing worth testing is that the transport and the routes agree, and a
 * mock would only ever confirm that the transport agrees with the mock.
 */
describe("httpTransport", () => {
  let base: string;
  let root: string;
  let source: string;
  let library: string;
  let app: ReturnType<typeof createApp>;
  let transport: Transport;

  function transportFor(token: string): Transport {
    return createHttpTransport({
      baseUrl: "http://server",
      token,
      fetch: (input, init) => app.request(String(input), init),
    });
  }

  beforeEach(async () => {
    base = await realpath(await mkdtemp("/tmp/stl-transport-"));
    root = join(base, "data");
    source = join(root, "downloads");
    library = join(root, "library");
    await mkdir(source, { recursive: true });
    await mkdir(library, { recursive: true });
    await writeFile(join(source, "kit_base.stl"), "base-mesh");
    await writeFile(join(source, "kit_lip.stl"), "lip-mesh");

    const config: ServerConfig = { port: 8080, roots: [root], configDir: "/config", dropDir: "/config/drops", trustProxy: false, host: "127.0.0.1", isRemote: false };
    app = createApp({ config, token: TOKEN, shareToken: SHARE_TOKEN, fs: new NodeFileSystem(), path: posixPath });
    transport = transportFor(TOKEN);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("lists the roots", async () => {
    const result = await transport.listRoots();
    expect(result).toEqual({ ok: true, value: [{ path: root, label: "data" }] });
  });

  it("lists directories", async () => {
    const result = await transport.listDirectories({ path: root });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((entry) => entry.name)).toEqual(["downloads", "library"]);
    }
  });

  it("turns a scan job into a resolved plan", async () => {
    const result = await transport.buildPlan({ roots: [source], libraryRoot: library });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.groups).toHaveLength(1);
      expect(result.value.moves).toHaveLength(2);
    }
  });

  it("reports progress while a job runs", async () => {
    const seen: number[] = [];
    const unsubscribe = transport.onProgress((progress) => seen.push(progress.done));
    await transport.buildPlan({ roots: [source], libraryRoot: library });
    unsubscribe();
    expect(seen.length).toBeGreaterThan(0);
  });

  it("stops reporting after unsubscribing", async () => {
    const seen: number[] = [];
    transport.onProgress((progress) => seen.push(progress.done))();
    await transport.buildPlan({ roots: [source], libraryRoot: library });
    expect(seen).toEqual([]);
  });

  it("returns an error result rather than throwing when the server refuses", async () => {
    const result = await transport.buildPlan({ roots: ["/etc"], libraryRoot: library });
    expect(result.ok).toBe(false);
  });

  it("returns an error result when the token is wrong", async () => {
    const result = await transportFor("b".repeat(64)).listRoots();
    expect(result.ok).toBe(false);
  });

  it("returns an error result rather than throwing when the server is unreachable", async () => {
    const broken = createHttpTransport({
      baseUrl: "http://server",
      token: TOKEN,
      fetch: () => Promise.reject(new Error("connection refused")),
    });
    const result = await broken.listRoots();
    expect(result).toEqual({ ok: false, error: "connection refused" });
  });

  it("applies a plan and can then read the library back", async () => {
    const planned = await transport.buildPlan({ roots: [source], libraryRoot: library });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }

    const applied = await transport.applyPlan({ libraryRoot: library, moves: planned.value.moves });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.value.moved).toBe(2);
    }

    const tree = await transport.readLibrary({ libraryRoot: library });
    expect(tree.ok).toBe(true);
    if (tree.ok) {
      expect(tree.value.fileCount).toBe(2);
    }
  });

  it("undoes a run and puts the files back", async () => {
    const planned = await transport.buildPlan({ roots: [source], libraryRoot: library });
    if (!planned.ok) {
      throw new Error("the plan failed");
    }
    const applied = await transport.applyPlan({ libraryRoot: library, moves: planned.value.moves });
    if (!applied.ok) {
      throw new Error("the apply failed");
    }

    const reversed = await transport.undoRun({ libraryRoot: library, runId: applied.value.runId });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect(reversed.value.restored).toBe(2);
    }

    const fs = new NodeFileSystem();
    expect(await fs.exists(join(source, "kit_base.stl"))).toBe(true);
  });

  it("reveals nothing in a browser, without failing", async () => {
    expect(await transport.revealInFinder({ path: library })).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
