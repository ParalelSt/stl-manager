import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
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
 * A realistic collection sorted entirely over HTTP.
 *
 * The engine has its own version of this against the filesystem directly. This
 * one proves the same rules survive the trip through the transport, the
 * routes, the path guard and the job model, which is the only way to know the
 * server has not quietly changed the behaviour.
 */
describe("a realistic collection over HTTP", () => {
  let base: string;
  let root: string;
  let source: string;
  let library: string;
  let transport: Transport;

  async function write(relative: string, contents: string): Promise<void> {
    const full = join(source, relative);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, contents);
  }

  async function libraryTree(): Promise<string[]> {
    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const found: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name);
        found.push(...(entry.isDirectory() ? await walk(path) : [path.slice(library.length + 1)]));
      }
      return found;
    }
    return (await walk(library)).filter((path) => !path.startsWith(".stl-manager")).sort();
  }

  beforeEach(async () => {
    // Not the system temp directory: on macOS that resolves under /private/var,
    // which the scanner excludes as system state.
    base = await realpath(await mkdtemp("/tmp/stl-e2e-"));
    root = join(base, "data");
    source = join(root, "collection");
    library = join(root, "library");
    await mkdir(source, { recursive: true });
    await mkdir(library, { recursive: true });

    // A family sharing a name, with a companion.
    await write("Terrain Pack/ruined_tower.stl", "tower-mesh");
    await write("Terrain Pack/ruined_tower.jpg", "preview");
    await write("Terrain Pack/ruined_wall.stl", "wall-mesh");
    // Duplicates in three suffix forms, all identical.
    await write("Terrain Pack/ruined_tower (1).stl", "tower-mesh");
    await write("Terrain Pack/ruined_tower copy.stl", "tower-mesh");
    await write("Terrain Pack/ruined_tower copy 2.stl", "tower-mesh");
    // Same name, different contents: both must survive.
    await write("Busts/orc bust.stl", "orc-one");
    await write("Busts/orc bust (2).stl", "orc-two-which-differs");
    // A numbered set with no shared word.
    await write("Vacuum Kit/01_adapter.stl", "a");
    await write("Vacuum Kit/02_pipe.stl", "b");
    await write("Vacuum Kit/03_elbow.stl", "c");
    // Never collected.
    await write("Notes/taxes.docx", "unrelated");

    const config: ServerConfig = { port: 8080, roots: [root], configDir: "/config", dropDir: "/config/drops", trustProxy: false, host: "127.0.0.1", isRemote: false };
    const app = createApp({ config, token: TOKEN, shareToken: SHARE_TOKEN, fs: new NodeFileSystem(), path: posixPath });
    transport = createHttpTransport({
      baseUrl: "http://server",
      token: TOKEN,
      fetch: (input, init) => app.request(String(input), init),
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("sorts, then reverses, exactly as the engine does directly", async () => {
    const planned = await transport.buildPlan({ roots: [source], libraryRoot: library });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }

    const applied = await transport.applyPlan({
      libraryRoot: library,
      moves: planned.value.moves,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value.failed).toBe(0);
    expect(applied.value.skipped).toBe(0);

    const tree = await libraryTree();
    const sorted = tree.filter((path) => !path.startsWith("_Duplicates"));
    const quarantined = tree.filter((path) => path.startsWith("_Duplicates"));

    expect(sorted).toEqual(
      [
        // A family named after the words its members share. The tower is a
        // mesh and a preview, so those travel together in a folder of their
        // own; the wall is a single file and needs none.
        "ruined/ruined_tower/ruined_tower.stl",
        "ruined/ruined_tower/ruined_tower.jpg",
        "ruined/ruined_wall.stl",
        // Same name, different contents, so both are kept.
        "orc bust/orc bust (2).stl",
        "orc bust/orc bust.stl",
        // A numbered run takes its name from the folder it came from.
        "Vacuum Kit/01_adapter.stl",
        "Vacuum Kit/02_pipe.stl",
        "Vacuum Kit/03_elbow.stl",
      ].sort(),
    );

    // All three identical copies set aside, none deleted.
    expect(quarantined).toHaveLength(3);

    // The document was never collected.
    const fs = new NodeFileSystem();
    expect(await fs.exists(join(source, "Notes/taxes.docx"))).toBe(true);

    const runs = await transport.listRuns({ libraryRoot: library });
    expect(runs.ok).toBe(true);
    if (runs.ok) {
      expect(runs.value).toHaveLength(1);
    }

    const reversed = await transport.undoRun({
      libraryRoot: library,
      runId: applied.value.runId,
    });
    expect(reversed.ok).toBe(true);
    if (reversed.ok) {
      expect(reversed.value.problems).toEqual([]);
      expect(reversed.value.restored).toBe(applied.value.moved);
    }

    expect(await libraryTree()).toEqual([]);
    for (const original of [
      "Terrain Pack/ruined_tower.stl",
      "Terrain Pack/ruined_tower (1).stl",
      "Terrain Pack/ruined_tower copy.stl",
      "Terrain Pack/ruined_tower copy 2.stl",
      "Terrain Pack/ruined_tower.jpg",
      "Busts/orc bust.stl",
      "Busts/orc bust (2).stl",
      "Vacuum Kit/01_adapter.stl",
    ]) {
      expect(await fs.exists(join(source, original))).toBe(true);
    }
  });
});
