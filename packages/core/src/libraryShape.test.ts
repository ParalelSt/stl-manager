import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./memoryFileSystem.js";
import { plan } from "./planner.js";
import { posixPath } from "./posixPath.js";

/**
 * Asserts the shape of a whole library rather than one path at a time.
 *
 * The per-case tests in planner.test.ts each check a single destination, which
 * let a bug through where every winner kept its duplicate marker in the final
 * filename. Every path being individually defensible is not the same as the
 * library reading well, so this test looks at all of it at once.
 */
describe("the resulting library", () => {
  it("matches the layout described in the design", async () => {
    const fs = new MemoryFileSystem({
      "/home/Downloads/Terrain Pack 3/ruined_tower.stl": { content: "tower-mesh" },
      "/home/Downloads/Terrain Pack 3/ruined_tower (1).stl": { content: "tower-mesh" },
      "/home/Downloads/Terrain Pack 3/barricade.stl": { content: "barricade-mesh" },
      "/home/Downloads/Terrain Pack 3/preview.jpg": { content: "img" },
      "/home/Models/space_marine.stl": { content: "marine-mesh" },
      "/home/Models/space_marine.jpg": { content: "marine-img" },
      "/home/Old Backup/space_marine copy.stl": { content: "marine-mesh" },
      "/home/Busts/orc bust.stl": { content: "orc-v1" },
      "/home/Busts/orc bust (2).stl": { content: "orc-v2-different" },
      "/home/Busts/dwarf bust.stl": { content: "dwarf" },
      "/home/Photos/holiday.jpg": { content: "unrelated" },
    });

    const result = await plan({ fs, path: posixPath, roots: ["/home"], libraryRoot: "/lib" });
    const destinations = result.moves.map((move) => move.to).sort();

    expect(destinations).toEqual([
      // A folder holding several models becomes a purpose.
      "/lib/Busts/dwarf bust/dwarf bust.stl",
      // Same name, different contents: both survive, distinguished by suffix.
      "/lib/Busts/orc bust/orc bust (2).stl",
      "/lib/Busts/orc bust/orc bust.stl",
      "/lib/Terrain Pack 3/barricade/barricade.stl",
      // The winner is stored under the clean name, not "ruined_tower (1).stl".
      "/lib/Terrain Pack 3/ruined_tower/ruined_tower.stl",
      // Byte-identical copies are quarantined under their original path.
      "/lib/_Duplicates/Downloads/Terrain Pack 3/ruined_tower.stl",
      "/lib/_Duplicates/Models/space_marine.stl",
      // Two directories each held one model, so neither becomes a purpose.
      "/lib/space_marine/space_marine.jpg",
      "/lib/space_marine/space_marine.stl",
    ]);

    expect(result.untouched.map((file) => file.path).sort()).toEqual([
      // No model shares this directory at all.
      "/home/Photos/holiday.jpg",
      // Its directory holds two groups and its name matches neither.
      "/home/Downloads/Terrain Pack 3/preview.jpg",
    ].sort());
  });
});
