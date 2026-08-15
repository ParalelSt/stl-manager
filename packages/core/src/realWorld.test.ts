import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apply } from "./applier.js";
import { Journal } from "./journal.js";
import { NodeFileSystem } from "./nodeFileSystem.js";
import { plan } from "./planner.js";
import { posixPath } from "./posixPath.js";
import { undo } from "./undo.js";

/**
 * A single run over a tree containing every case the design describes, against
 * real files.
 *
 * Each rule has its own unit test. This checks they still behave when they all
 * apply at once, which is the only way the application is ever actually used.
 */
describe("a realistic collection", () => {
  let root: string;
  let source: string;
  let library: string;
  const fs = new NodeFileSystem();

  async function write(relativePath: string, contents: string): Promise<void> {
    const full = join(source, relativePath);
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
    const all = await walk(library);
    return all.filter((path) => !path.startsWith(".stl-manager")).sort();
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "stl-manager-real-"));
    source = join(root, "source");
    library = join(root, "library");
    await mkdir(library, { recursive: true });

    // A folder with several models becomes a purpose.
    await write("Downloads/Terrain Pack/ruined_tower.stl", "tower-mesh");
    await write("Downloads/Terrain Pack/barricade.stl", "barricade-mesh");
    // Duplicates in three different suffix forms, all byte-identical.
    await write("Downloads/Terrain Pack/ruined_tower (1).stl", "tower-mesh");
    await write("Downloads/Terrain Pack/ruined_tower copy.stl", "tower-mesh");
    await write("Downloads/Terrain Pack/ruined_tower copy 2.stl", "tower-mesh");
    // A companion sharing a model's name travels with it.
    await write("Downloads/Terrain Pack/ruined_tower.jpg", "preview");
    // A companion matching nothing, in a folder with two models, stays put.
    await write("Downloads/Terrain Pack/licence.txt", "terms");

    // Deeply nested, and a folder holding one model, so no purpose.
    await write("Models/Characters/Heroes/Elf Ranger/elf_ranger.stl", "elf-mesh");

    // Same name, genuinely different contents: both must survive.
    await write("Models/Busts/orc bust.stl", "orc-version-one");
    await write("Models/Busts/orc bust (2).stl", "orc-version-two-which-differs");
    await write("Models/Busts/dwarf bust.stl", "dwarf-mesh");

    // A slicer file beside its model.
    await write("Models/Busts/dwarf bust.ctb", "sliced");

    // Not collected at all.
    await write("Documents/taxes.docx", "unrelated");
    await write("Pictures/holiday.jpg", "unrelated");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("sorts everything correctly and reverses cleanly", async () => {
    const sorted = await plan({ fs, path: posixPath, roots: [source], libraryRoot: library });
    const applied = await apply({
      fs,
      path: posixPath,
      plan: sorted,
      journal: new Journal(fs, posixPath, library),
      runId: "run-1",
    });

    expect(applied.failed).toBe(0);
    expect(applied.skipped).toBe(0);

    const quarantined = (await libraryTree()).filter((path) => path.startsWith("_Duplicates"));
    // Quarantine mirrors the path relative to the scanned folder, not from the
    // filesystem root, so the tree stays shallow.
    expect(quarantined.every((path) => !path.includes("/Users/"))).toBe(true);
    const sortedFiles = (await libraryTree()).filter((path) => !path.startsWith("_Duplicates"));

    expect(sortedFiles).toEqual([
      // Two models in one folder, so "Terrain Pack" became a purpose. The
      // winner is stored under the clean name with no duplicate marker.
      "Terrain Pack/barricade/barricade.stl",
      "Terrain Pack/ruined_tower/ruined_tower.jpg",
      "Terrain Pack/ruined_tower/ruined_tower.stl",
      // Busts held two distinct models, so it is a purpose too. The two orc
      // busts differ in content, so both survive despite sharing a name.
      "Busts/dwarf bust/dwarf bust.ctb",
      "Busts/dwarf bust/dwarf bust.stl",
      "Busts/orc bust/orc bust (2).stl",
      "Busts/orc bust/orc bust.stl",
      // Its folder held one model, so it gets no purpose folder.
      "elf_ranger/elf_ranger.stl",
    ].sort());

    // All three identical copies were quarantined, none deleted.
    expect(quarantined).toHaveLength(3);

    // The unrelated files were never touched.
    expect(await fs.exists(join(source, "Documents/taxes.docx"))).toBe(true);
    expect(await fs.exists(join(source, "Pictures/holiday.jpg"))).toBe(true);
    // The licence matched no model in a folder holding two, so it stayed.
    expect(await fs.exists(join(source, "Downloads/Terrain Pack/licence.txt"))).toBe(true);

    const reversed = await undo({
      fs,
      path: posixPath,
      journal: new Journal(fs, posixPath, library),
      runId: "run-1",
    });

    expect(reversed.problems).toEqual([]);
    expect(reversed.restored).toBe(applied.moved);
    expect(await libraryTree()).toEqual([]);

    for (const original of [
      "Downloads/Terrain Pack/ruined_tower.stl",
      "Downloads/Terrain Pack/ruined_tower (1).stl",
      "Downloads/Terrain Pack/ruined_tower copy.stl",
      "Downloads/Terrain Pack/ruined_tower copy 2.stl",
      "Downloads/Terrain Pack/ruined_tower.jpg",
      "Models/Characters/Heroes/Elf Ranger/elf_ranger.stl",
      "Models/Busts/orc bust.stl",
      "Models/Busts/orc bust (2).stl",
      "Models/Busts/dwarf bust.ctb",
    ]) {
      expect(await fs.exists(join(source, original))).toBe(true);
    }
  });
});
