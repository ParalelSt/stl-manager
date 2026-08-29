import { makeTempDir } from "./testing.js";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apply } from "./applier.js";
import { Journal } from "./journal.js";
import { NodeFileSystem } from "./nodeFileSystem.js";
import { plan } from "./planner.js";
import { posixPath } from "./posixPath.js";
import { undo } from "./undo.js";

/**
 * Exercises the whole pipeline against real files.
 *
 * The unit tests all run against MemoryFileSystem, which means none of them
 * prove the stages fit together over an actual disk. This one does, including
 * the part that matters most: that a completed run can be fully reversed.
 */
describe("the whole pipeline", () => {
  let root: string;
  let source: string;
  let library: string;
  const fs = new NodeFileSystem();

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...(await walk(path)));
      } else {
        found.push(path.slice(library.length + 1));
      }
    }
    return found.sort();
  }

  beforeEach(async () => {
    root = await makeTempDir("stl-manager-pipeline");
    source = join(root, "source");
    library = join(root, "library");
    await mkdir(join(source, "Terrain Pack"), { recursive: true });
    await mkdir(join(source, "Models"), { recursive: true });
    await mkdir(library, { recursive: true });

    await writeFile(join(source, "Terrain Pack", "tower.stl"), "tower-mesh");
    await writeFile(join(source, "Terrain Pack", "tower (1).stl"), "tower-mesh");
    await writeFile(join(source, "Terrain Pack", "wall.stl"), "wall-mesh");
    await writeFile(join(source, "Terrain Pack", "tower.jpg"), "preview");
    await writeFile(join(source, "Models", "hero.stl"), "hero-mesh");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("sorts real files into a library and puts them all back on undo", async () => {
    const sorted = await plan({ fs, path: posixPath, roots: [source], libraryRoot: library });

    const journal = new Journal(fs, posixPath, library);
    const applied = await apply({
      fs,
      path: posixPath,
      plan: sorted,
      journal,
      runId: "run-1",
    });

    expect(applied.failed).toBe(0);
    expect(applied.skipped).toBe(0);

    expect(await walk(library)).toEqual(
      [
        ".stl-manager/journal.jsonl",
        "Terrain Pack/tower/tower.jpg",
        "Terrain Pack/tower/tower.stl",
        "Terrain Pack/wall/wall.stl",
        // "tower (1).stl" carries the higher duplicate index, so it wins and is
        // stored under the clean name. The original loses and is quarantined.
        "_Duplicates/Terrain Pack/tower.stl",
        "hero/hero.stl",
      ].sort(),
    );

    const reversed = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(reversed.problems).toEqual([]);
    expect(reversed.restored).toBe(applied.moved);

    expect(await fs.exists(join(source, "Terrain Pack", "tower.stl"))).toBe(true);
    expect(await fs.exists(join(source, "Terrain Pack", "tower (1).stl"))).toBe(true);
    expect(await fs.exists(join(source, "Terrain Pack", "wall.stl"))).toBe(true);
    expect(await fs.exists(join(source, "Terrain Pack", "tower.jpg"))).toBe(true);
    expect(await fs.exists(join(source, "Models", "hero.stl"))).toBe(true);

    expect(await walk(library)).toEqual([".stl-manager/journal.jsonl"]);
  });
});
