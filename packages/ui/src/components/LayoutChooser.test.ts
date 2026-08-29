import { plan, posixPath, SORTING_PROFILES } from "@stl-manager/core";
import { MemoryFileSystem } from "@stl-manager/core/testing";
import { describe, expect, it } from "vitest";
import { EXAMPLE_FILES, LAYOUTS } from "./LayoutChooser.js";

const LIBRARY = "/lib";

/**
 * Renders destination paths as the indented tree the chooser shows.
 *
 * Sorted throughout, so the comparison depends on the shape of the library
 * rather than on the order the engine happened to plan its moves in.
 */
function renderTree(paths: string[]): string[] {
  const lines: string[] = [];
  const walk = (prefix: string, entries: string[][], depth: number): void => {
    const heads = [...new Set(entries.map((entry) => entry[0] ?? ""))].sort();
    for (const head of heads) {
      const beneath = entries
        .filter((entry) => entry[0] === head)
        .map((entry) => entry.slice(1))
        .filter((entry) => entry.length > 0);
      const indent = "  ".repeat(depth);
      lines.push(`${indent}${head}${beneath.length > 0 ? "/" : ""}`);
      if (beneath.length > 0) {
        walk(`${prefix}/${head}`, beneath, depth + 1);
      }
    }
  };
  walk("", paths.map((path) => path.slice(LIBRARY.length + 1).split("/")), 0);
  return lines;
}

/**
 * Puts the chooser's own example through the engine.
 *
 * The trees on that screen claim to show what each layout produces. This is
 * what makes the claim true: change how a layout groups and this fails, rather
 * than the screen quietly describing behaviour the application no longer has.
 */
describe("the layout examples", () => {
  it.each(SORTING_PROFILES)("match what %s actually produces", async (profile) => {
    const seed = Object.fromEntries(
      EXAMPLE_FILES.map((path, index) => [path, { content: `mesh-${index}` }]),
    );
    const built = await plan({
      fs: new MemoryFileSystem(seed),
      path: posixPath,
      roots: ["/scan"],
      libraryRoot: LIBRARY,
      profile,
    });

    expect(built.moves).toHaveLength(EXAMPLE_FILES.length);
    expect(renderTree(built.moves.map((move) => move.to))).toEqual(LAYOUTS[profile].tree);
  });
});
