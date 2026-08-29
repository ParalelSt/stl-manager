import { makeTempDir } from "@stl-manager/core/testing";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath, type TreeFile, type TreeFolder, type TreeNode } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";

const MINE_TOKEN = "a".repeat(64);
const MINE_SHARE = "b".repeat(64);
const THEIRS_TOKEN = "c".repeat(64);
const THEIRS_SHARE = "d".repeat(64);
const THEIR_URL = "http://linux-pc:8080";

/** Every file in a catalogue tree, flattened. */
function filesIn(node: TreeNode): TreeFile[] {
  if (node.kind === "file") {
    return [node];
  }
  return node.children.flatMap((child) => filesIn(child));
}

/**
 * The whole point of the phase, exercised end to end.
 *
 * Two machines, each with its own library. One browses the other, pulls a
 * model, and files it by its own rules. The serving machine keeps its copy
 * throughout, because pulling copies rather than moves.
 */
describe("two machines sharing", () => {
  let base: string;
  let mineRoot: string;
  let mineLibrary: string;
  let mineStaging: string;
  let theirsRoot: string;
  let theirsLibrary: string;
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

  async function settle(jobId: string): Promise<{ state: string; result?: unknown }> {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const body = await (await asOwner(`/api/jobs/${jobId}`)).json();
      if (body.value.state !== "running") {
        return body.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The job never finished.");
  }

  async function libraryTree(root: string): Promise<string[]> {
    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry.name);
        found.push(...(entry.isDirectory() ? await walk(full) : [full.slice(root.length + 1)]));
      }
      return found;
    }
    return (await walk(root)).filter((path) => !path.startsWith(".stl-manager")).sort();
  }

  beforeEach(async () => {
    base = await makeTempDir("stl-peer-e2e");
    mineRoot = join(base, "mine");
    mineLibrary = join(mineRoot, "library");
    mineStaging = join(mineRoot, "_Incoming");
    theirsRoot = join(base, "theirs");
    theirsLibrary = join(theirsRoot, "library");

    await mkdir(mineLibrary, { recursive: true });
    await mkdir(mineStaging, { recursive: true });
    await mkdir(join(base, "mine-config"), { recursive: true });
    await mkdir(join(theirsLibrary, "Terrain", "ruined_tower"), { recursive: true });
    await mkdir(join(base, "theirs-config"), { recursive: true });

    // Their library holds a small family: a model, a companion, and a sibling.
    await writeFile(join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.stl"), "tower-mesh");
    await writeFile(join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.jpg"), "preview");
    await mkdir(join(theirsLibrary, "Terrain", "ruined_wall"), { recursive: true });
    await writeFile(join(theirsLibrary, "Terrain", "ruined_wall", "ruined_wall.stl"), "wall-mesh");

    const theirs = createApp({
      config: { port: 8080, roots: [theirsRoot], configDir: join(base, "theirs-config"), dropDir: join(base, "theirs-drops") },
      token: THEIRS_TOKEN,
      shareToken: THEIRS_SHARE,
      fs: new NodeFileSystem(),
      path: posixPath,
    });

    const mineConfig: ServerConfig = {
      port: 8080,
      roots: [mineRoot],
      configDir: join(base, "mine-config"),
      dropDir: join(base, "mine-drops"),
    };
    mine = createApp({
      config: mineConfig,
      token: MINE_TOKEN,
      shareToken: MINE_SHARE,
      fs: new NodeFileSystem(),
      path: posixPath,
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

  it("pairs, pulls, and files the result by the receiving machine's rules", async () => {
    // Pair.
    const paired = await (
      await asOwner("/api/peers", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: THEIR_URL,
          shareToken: THEIRS_SHARE,
          libraryRoot: theirsLibrary,
          label: "linux-pc",
        }),
      })
    ).json();
    expect(paired.ok).toBe(true);
    const peerId = paired.value.id;

    // Browse what they have.
    const catalogue = await (await asOwner(`/api/peers/${peerId}/catalogue`)).json();
    const remoteFiles = filesIn(catalogue.value as TreeFolder);
    expect(remoteFiles).toHaveLength(3);

    // Pull the whole Terrain family.
    const started = await (
      await asOwner(`/api/peers/${peerId}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          stagingDir: mineStaging,
          paths: remoteFiles.map((file) => file.path),
        }),
      })
    ).json();
    const pulled = await settle(started.value.jobId);
    expect(pulled.state).toBe("succeeded");
    expect((pulled.result as { fetched: number; failed: unknown[] })).toMatchObject({
      fetched: 3,
      failed: [],
    });

    // The serving machine still has everything: pulling copies, never moves.
    expect(await libraryTree(theirsLibrary)).toEqual([
      "Terrain/ruined_tower/ruined_tower.jpg",
      "Terrain/ruined_tower/ruined_tower.stl",
      "Terrain/ruined_wall/ruined_wall.stl",
    ]);

    // Now sort the staging folder with my own rules, as an ordinary run.
    const scan = await (
      await asOwner("/api/scans", {
        method: "POST",
        body: JSON.stringify({ roots: [mineStaging], libraryRoot: mineLibrary }),
      })
    ).json();
    const planned = await settle(scan.value.jobId);
    expect(planned.state).toBe("succeeded");

    const plan = planned.result as { moves: { from: string; to: string; size: number }[] };
    const applied = await (
      await asOwner("/api/applies", {
        method: "POST",
        body: JSON.stringify({ libraryRoot: mineLibrary, moves: plan.moves }),
      })
    ).json();
    const done = await settle(applied.value.jobId);
    expect(done.state).toBe("succeeded");

    // Filed by my grouping, not by theirs: the two models share a first word,
    // so they land in one family folder rather than the two the peer used.
    expect(await libraryTree(mineLibrary)).toEqual([
      // ruined_tower is a mesh and a preview, so the two travel together in a
      // folder of their own. ruined_wall is a single file and needs none.
      "ruined/ruined_tower/ruined_tower.jpg",
      "ruined/ruined_tower/ruined_tower.stl",
      "ruined/ruined_wall.stl",
    ]);

    // And the move is journalled like any other, so it can be undone.
    const runs = await (
      await asOwner(`/api/runs?libraryRoot=${encodeURIComponent(mineLibrary)}`)
    ).json();
    expect(runs.value).toHaveLength(1);
  });

  it("does not duplicate a model when the same pull is run twice", async () => {
    const paired = await (
      await asOwner("/api/peers", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: THEIR_URL,
          shareToken: THEIRS_SHARE,
          libraryRoot: theirsLibrary,
        }),
      })
    ).json();

    const remotePath = join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.stl");
    const body = JSON.stringify({ stagingDir: mineStaging, paths: [remotePath] });

    const first = await (
      await asOwner(`/api/peers/${paired.value.id}/pulls`, { method: "POST", body })
    ).json();
    await settle(first.value.jobId);

    const second = await (
      await asOwner(`/api/peers/${paired.value.id}/pulls`, { method: "POST", body })
    ).json();
    const job = await settle(second.value.jobId);

    // The second pull recognises it already has the file rather than writing
    // a second copy beside it.
    expect((job.result as { fetched: number; skipped: number })).toMatchObject({
      fetched: 0,
      skipped: 1,
    });
    expect(await readdir(mineStaging)).toEqual(["ruined_tower.stl"]);
  });

  it("keeps a model already in the library rather than overwriting it", async () => {
    const paired = await (
      await asOwner("/api/peers", {
        method: "POST",
        body: JSON.stringify({
          baseUrl: THEIR_URL,
          shareToken: THEIRS_SHARE,
          libraryRoot: theirsLibrary,
        }),
      })
    ).json();

    const remotePath = join(theirsLibrary, "Terrain", "ruined_tower", "ruined_tower.stl");
    const body = JSON.stringify({ stagingDir: mineStaging, paths: [remotePath] });

    async function pullAndSort(): Promise<void> {
      const pull = await (
        await asOwner(`/api/peers/${paired.value.id}/pulls`, { method: "POST", body })
      ).json();
      await settle(pull.value.jobId);
      const scan = await (
        await asOwner("/api/scans", {
          method: "POST",
          body: JSON.stringify({ roots: [mineStaging], libraryRoot: mineLibrary }),
        })
      ).json();
      const planned = await settle(scan.value.jobId);
      const plan = planned.result as { moves: unknown[] };
      const applied = await (
        await asOwner("/api/applies", {
          method: "POST",
          body: JSON.stringify({ libraryRoot: mineLibrary, moves: plan.moves }),
        })
      ).json();
      await settle(applied.value.jobId);
    }

    await pullAndSort();
    const afterFirst = await libraryTree(mineLibrary);
    expect(afterFirst).toEqual(["ruined_tower/ruined_tower.stl"]);

    await pullAndSort();
    const afterSecond = await libraryTree(mineLibrary);

    // The first file is untouched. That is the guarantee that matters, and it
    // is what the overwrite fix in the planner and applier exists for.
    expect(afterSecond).toContain("ruined_tower/ruined_tower.stl");

    // A known limitation rather than a bug: the second copy lands beside it
    // instead of being recognised as a duplicate, because the scanner never
    // looks inside the library and so cannot compare against what is already
    // filed. Nothing is lost; the user sees two and can delete one.
    expect(afterSecond).toEqual([
      "ruined_tower/ruined_tower (2).stl",
      "ruined_tower/ruined_tower.stl",
    ]);
  });
});
