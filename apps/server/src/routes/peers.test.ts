import { makeTempDir } from "@stl-manager/core/testing";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";

const MINE_TOKEN = "a".repeat(64);
const MINE_SHARE = "b".repeat(64);
const THEIRS_TOKEN = "c".repeat(64);
const THEIRS_SHARE = "d".repeat(64);

const THEIR_URL = "http://linux-pc:8080";

/**
 * Two servers, wired to each other.
 *
 * One machine's outbound fetch is routed straight into the other's
 * application, so the real contract between them is exercised without opening
 * a socket. A mock on either side would only prove the mock agrees with itself.
 */
describe("peers", () => {
  let base: string;
  let mineRoot: string;
  let mineLibrary: string;
  let mineStaging: string;
  let mineConfig: string;
  let theirsRoot: string;
  let theirsLibrary: string;
  let theirsConfig: string;
  let mine: ReturnType<typeof createApp>;

  function asOwner(path: string, init?: RequestInit): Promise<Response> {
    return mine.request(path, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${MINE_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  }

  function pairBody(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      baseUrl: THEIR_URL,
      shareToken: THEIRS_SHARE,
      libraryRoot: theirsLibrary,
      label: "linux-pc",
      ...overrides,
    });
  }

  async function settle(jobId: string): Promise<{ state: string; result?: unknown }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const body = await (await asOwner(`/api/jobs/${jobId}`)).json();
      if (body.value.state !== "running") {
        return body.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The job never finished.");
  }

  beforeEach(async () => {
    base = await makeTempDir("stl-peers");
    mineRoot = join(base, "mine");
    mineLibrary = join(mineRoot, "library");
    mineStaging = join(mineRoot, "_Incoming");
    mineConfig = join(base, "mine-config");
    theirsRoot = join(base, "theirs");
    theirsLibrary = join(theirsRoot, "library");
    theirsConfig = join(base, "theirs-config");

    await mkdir(mineLibrary, { recursive: true });
    await mkdir(mineStaging, { recursive: true });
    await mkdir(mineConfig, { recursive: true });
    await mkdir(join(theirsLibrary, "Terrain", "ruined_tower"), { recursive: true });
    await mkdir(theirsConfig, { recursive: true });
    await writeFile(join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.stl"), "tower-mesh");
    await writeFile(join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.jpg"), "preview");
    // Inside their roots but outside their library: a peer must not see it.
    await writeFile(join(theirsRoot, "private.stl"), "not shared");

    const theirsConfigured: ServerConfig = {
      port: 8080,
      roots: [theirsRoot],
      configDir: theirsConfig,
      dropDir: join(theirsConfig, "drops"),
    };
    const theirs = createApp({
      config: theirsConfigured,
      token: THEIRS_TOKEN,
      shareToken: THEIRS_SHARE,
      fs: new NodeFileSystem(),
      path: posixPath,
    });

    const mineConfigured: ServerConfig = { port: 8080, roots: [mineRoot], configDir: mineConfig, dropDir: join(mineConfig, "drops") };
    mine = createApp({
      config: mineConfigured,
      token: MINE_TOKEN,
      shareToken: MINE_SHARE,
      fs: new NodeFileSystem(),
      path: posixPath,
      // Anything my machine sends to their address goes to their application.
      fetch: (input, init) => {
        const url = String(input);
        if (!url.startsWith(THEIR_URL)) {
          return Promise.reject(new Error(`Nothing is listening at ${url}.`));
        }
        return theirs.request(url.slice(THEIR_URL.length), init);
      },
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  describe("pairing", () => {
    it("pairs with a machine and remembers it", async () => {
      expect((await asOwner("/api/peers", { method: "POST", body: pairBody() })).status).toBe(201);
      const body = await (await asOwner("/api/peers")).json();
      expect(body.value).toHaveLength(1);
      expect(body.value[0].label).toBe("linux-pc");
    });

    it("never returns the peer's share token to the interface", async () => {
      await asOwner("/api/peers", { method: "POST", body: pairBody() });
      const text = await (await asOwner("/api/peers")).text();
      expect(text).not.toContain(THEIRS_SHARE);
    });

    it("refuses a wrong share token at the moment of pairing", async () => {
      const response = await asOwner("/api/peers", {
        method: "POST",
        body: pairBody({ shareToken: "z".repeat(64) }),
      });
      expect(response.status).toBe(400);
    });

    it("refuses an unreachable address", async () => {
      const response = await asOwner("/api/peers", {
        method: "POST",
        body: pairBody({ baseUrl: "http://nothing-here:9999" }),
      });
      expect(response.status).toBe(400);
    });

    it("refuses a body missing an address or token", async () => {
      expect((await asOwner("/api/peers", { method: "POST", body: "{}" })).status).toBe(400);
    });

    it("replaces rather than duplicates when pairing the same address twice", async () => {
      await asOwner("/api/peers", { method: "POST", body: pairBody() });
      await asOwner("/api/peers", { method: "POST", body: pairBody({ label: "renamed" }) });
      const body = await (await asOwner("/api/peers")).json();
      expect(body.value).toHaveLength(1);
      expect(body.value[0].label).toBe("renamed");
    });

    it("forgets a peer", async () => {
      const added = await (await asOwner("/api/peers", { method: "POST", body: pairBody() })).json();
      await asOwner(`/api/peers/${added.value.id}`, { method: "DELETE" });
      expect((await (await asOwner("/api/peers")).json()).value).toEqual([]);
    });

    it("requires the machine's own token, not a share token", async () => {
      const response = await mine.request("/api/peers", {
        headers: { Authorization: `Bearer ${MINE_SHARE}` },
      });
      expect(response.status).toBe(401);
    });
  });

  describe("browsing a peer", () => {
    it("shows what the other machine holds", async () => {
      const added = await (await asOwner("/api/peers", { method: "POST", body: pairBody() })).json();
      const body = await (await asOwner(`/api/peers/${added.value.id}/catalogue`)).json();
      expect(body.value.fileCount).toBe(2);
      expect(body.value.children[0].name).toBe("Terrain");
    });

    it("returns 404 for a peer that is not paired", async () => {
      expect((await asOwner("/api/peers/nope/catalogue")).status).toBe(404);
    });
  });

  describe("pulling", () => {
    async function pair(): Promise<string> {
      const added = await (await asOwner("/api/peers", { method: "POST", body: pairBody() })).json();
      return added.value.id;
    }

    it("fetches files into the staging folder", async () => {
      const id = await pair();
      const started = await (
        await asOwner(`/api/peers/${id}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            stagingDir: mineStaging,
            paths: [join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.stl")],
          }),
        })
      ).json();

      const job = await settle(started.value.jobId);
      expect(job.state).toBe("succeeded");
      expect((job.result as { fetched: number }).fetched).toBe(1);
      expect(await readdir(mineStaging)).toEqual(["ruined_tower.stl"]);
    });

    it("refuses to write outside staging when a peer supplies a hostile name", async () => {
      // The name comes from the other machine, so it is never trusted to build
      // a path with. Only the last segment is used, and never ".." itself.
      const id = await pair();
      const started = await (
        await asOwner(`/api/peers/${id}/pulls`, {
          method: "POST",
          body: JSON.stringify({ stagingDir: mineStaging, paths: ["../../../etc/passwd", "/.."] }),
        })
      ).json();

      const job = await settle(started.value.jobId);
      const result = job.result as { fetched: number; failed: unknown[] };
      expect(result.fetched).toBe(0);
      expect(result.failed).toHaveLength(2);
      expect(await readdir(mineStaging)).toEqual([]);
    });

    it("cannot fetch a file the peer holds outside its library", async () => {
      const id = await pair();
      const started = await (
        await asOwner(`/api/peers/${id}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            stagingDir: mineStaging,
            paths: [join(theirsRoot, "private.stl")],
          }),
        })
      ).json();

      const job = await settle(started.value.jobId);
      expect((job.result as { fetched: number }).fetched).toBe(0);
      expect(await readdir(mineStaging)).toEqual([]);
    });

    it("skips a file it already has at the same size", async () => {
      const id = await pair();
      const body = JSON.stringify({
        stagingDir: mineStaging,
        paths: [join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.stl")],
      });

      const first = await (await asOwner(`/api/peers/${id}/pulls`, { method: "POST", body })).json();
      await settle(first.value.jobId);
      const second = await (await asOwner(`/api/peers/${id}/pulls`, { method: "POST", body })).json();
      const job = await settle(second.value.jobId);

      expect((job.result as { fetched: number; skipped: number })).toMatchObject({
        fetched: 0,
        skipped: 1,
      });
    });

    it("leaves nothing partial behind", async () => {
      const id = await pair();
      const started = await (
        await asOwner(`/api/peers/${id}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            stagingDir: mineStaging,
            paths: [join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.jpg")],
          }),
        })
      ).json();
      await settle(started.value.jobId);
      expect((await readdir(mineStaging)).some((name) => name.endsWith(".partial"))).toBe(false);
    });

    it("refuses a staging folder outside the roots", async () => {
      const id = await pair();
      const response = await asOwner(`/api/peers/${id}/pulls`, {
        method: "POST",
        body: JSON.stringify({ stagingDir: "/etc", paths: [] }),
      });
      expect(response.status).toBe(400);
    });
  });
});
