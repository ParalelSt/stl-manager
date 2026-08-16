import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { apply, Journal, plan, posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { describe, expect, it } from "vitest";

/**
 * Sorting the same source folder into a library twice.
 *
 * This found a real defect: destination collisions were only avoided within a
 * single plan, so a second run could rename a file straight on top of one
 * already in the library. The original was lost, and the journal recorded the
 * new file's move, so undo could not recover it either.
 */
describe("applying twice into one library", () => {
  it("does not silently overwrite a file already there", async () => {
    const base = await realpath(await mkdtemp("/tmp/stl-overwrite-"));
    const source = join(base, "in");
    const library = join(base, "lib");
    await mkdir(source, { recursive: true });
    await mkdir(library, { recursive: true });
    const fs = new NodeFileSystem();

    // First run: file lands in the library.
    await writeFile(join(source, "tower.stl"), "ORIGINAL");
    const first = await plan({ fs, path: posixPath, roots: [source], libraryRoot: library });
    await apply({ fs, path: posixPath, plan: first, journal: new Journal(fs, posixPath, library), runId: "r1" });

    // Second run: a DIFFERENT file with the same name arrives.
    await writeFile(join(source, "tower.stl"), "DIFFERENT CONTENTS");
    const second = await plan({ fs, path: posixPath, roots: [source], libraryRoot: library });
    await apply({ fs, path: posixPath, plan: second, journal: new Journal(fs, posixPath, library), runId: "r2" });

    const landed = await readFile(join(library, "tower", "tower.stl"), "utf8");
    const alongside = await readdir(join(library, "tower"));
    await rm(base, { recursive: true, force: true });

    expect(landed).toBe("ORIGINAL");
    // The second file is kept beside it rather than discarded or merged.
    expect(alongside.sort()).toEqual(["tower (2).stl", "tower.stl"]);
  });
});
