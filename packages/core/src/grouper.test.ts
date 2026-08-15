import { describe, expect, it } from "vitest";
import { group } from "./grouper.js";
import { posixPath } from "./posixPath.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

function file(path: string, overrides: Partial<ScannedFile> = {}): ScannedFile {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return {
    path,
    stem,
    ext: ".stl",
    size: 100,
    mtimeMs: 1000,
    birthtimeMs: 1000,
    deviceId: 1,
    sourceDir: path.split("/").slice(0, -1).join("/"),
    duplicateIndex: undefined,
    kind: FILE_KIND.MESH,
    ...overrides,
  };
}

describe("group", () => {
  it("puts files sharing a name key in one group", () => {
    const groups = group([file("/a/Tower.stl"), file("/b/tower.stl")], posixPath);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files).toHaveLength(2);
  });

  it("keeps files with different names in different groups", () => {
    const groups = group([file("/a/tower.stl"), file("/a/wall.stl")], posixPath);
    expect(groups).toHaveLength(2);
  });

  it("assigns a purpose when a directory held two or more distinct names", () => {
    const groups = group(
      [file("/home/Terrain/tower.stl"), file("/home/Terrain/barricade.stl")],
      posixPath,
    );
    expect(groups.map((entry) => entry.purpose)).toEqual(["Terrain", "Terrain"]);
  });

  it("assigns no purpose when a directory held only one distinct name", () => {
    const groups = group([file("/home/Terrain/tower.stl")], posixPath);
    expect(groups[0]?.purpose).toBeUndefined();
  });

  it("does not count duplicates of one model as two distinct names", () => {
    const groups = group(
      [
        file("/home/Terrain/tower.stl"),
        file("/home/Terrain/tower (1).stl", { duplicateIndex: 1 }),
      ],
      posixPath,
    );
    expect(groups[0]?.purpose).toBeUndefined();
  });

  it("does not count a companion towards the distinct name total", () => {
    const groups = group(
      [
        file("/home/Terrain/tower.stl"),
        file("/home/Terrain/readme.txt", { ext: ".txt", kind: FILE_KIND.COMPANION }),
      ],
      posixPath,
    );
    const tower = groups.find((entry) => entry.displayName === "tower");
    expect(tower?.purpose).toBeUndefined();
  });

  it("takes the purpose from the directory contributing the most files", () => {
    const groups = group(
      [
        file("/home/Terrain/tower.stl"),
        file("/home/Terrain/wall.stl"),
        file("/home/Terrain/tower.obj", { ext: ".obj" }),
        file("/home/Random/tower.3mf", { ext: ".3mf" }),
        file("/home/Random/other.stl"),
      ],
      posixPath,
    );
    expect(groups.find((entry) => entry.displayName === "tower")?.purpose).toBe("Terrain");
  });

  it("breaks a purpose tie with the newest file", () => {
    const groups = group(
      [
        file("/home/Old/tower.stl", { birthtimeMs: 1000 }),
        file("/home/Old/wall.stl"),
        file("/home/New/tower.obj", { ext: ".obj", birthtimeMs: 9000 }),
        file("/home/New/gate.stl"),
      ],
      posixPath,
    );
    expect(groups.find((entry) => entry.displayName === "tower")?.purpose).toBe("New");
  });

  it("uses the most common original stem as the display name", () => {
    const groups = group(
      [
        file("/a/Space_Marine.stl"),
        file("/b/Space_Marine.obj", { ext: ".obj" }),
        file("/c/space marine.3mf", { ext: ".3mf" }),
      ],
      posixPath,
    );
    expect(groups[0]?.displayName).toBe("Space_Marine");
  });

  it("strips the duplicate marker from the display name", () => {
    const groups = group(
      [file("/a/tower (2).stl", { duplicateIndex: 2 })],
      posixPath,
    );
    expect(groups[0]?.displayName).toBe("tower");
  });

  it("drops files whose name key normalises to nothing", () => {
    expect(group([file("/a/___.stl")], posixPath)).toEqual([]);
  });

  it("returns groups sorted by display name", () => {
    const groups = group(
      [file("/a/zeta.stl"), file("/a/alpha.stl"), file("/a/mid.stl")],
      posixPath,
    );
    expect(groups.map((entry) => entry.displayName)).toEqual(["alpha", "mid", "zeta"]);
  });
});


describe("grouping into families", () => {
  it("puts models sharing a first word in one folder", () => {
    const groups = group(
      [file("/home/M/kit_base.stl"), file("/home/M/kit_lip.stl"), file("/home/M/tower.stl")],
      posixPath,
    );
    const kit = groups.find((entry) => entry.displayName === "kit");
    expect(kit?.files).toHaveLength(2);
  });

  it("keeps distinct models inside one family rather than merging them", () => {
    const groups = group(
      [file("/home/M/kit_base.stl"), file("/home/M/kit_lip.stl")],
      posixPath,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files.map((entry) => entry.stem).sort()).toEqual(["kit_base", "kit_lip"]);
  });

  it("recognises a numbered run as one set", () => {
    const groups = group(
      [
        file("/home/Vacuum Kit/01_adapter.stl"),
        file("/home/Vacuum Kit/02_pipe.stl"),
        file("/home/Vacuum Kit/03_elbow.stl"),
      ],
      posixPath,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.displayName).toBe("Vacuum Kit");
    expect(groups[0]?.isNumberedSet).toBe(true);
  });

  it("does not make an uninformative folder name into a purpose", () => {
    const groups = group(
      [file("/home/Downloads/tower.stl"), file("/home/Downloads/wall.stl")],
      posixPath,
    );
    expect(groups.every((entry) => entry.purpose === undefined)).toBe(true);
  });

  it("still uses an informative folder name as a purpose", () => {
    const groups = group(
      [file("/home/Terrain Pack/tower.stl"), file("/home/Terrain Pack/wall.stl")],
      posixPath,
    );
    expect(groups.every((entry) => entry.purpose === "Terrain Pack")).toBe(true);
  });

  it("does not nest a numbered set inside a folder of the same name", () => {
    const groups = group(
      [
        file("/home/Vacuum Kit/01_adapter.stl"),
        file("/home/Vacuum Kit/02_pipe.stl"),
        file("/home/Vacuum Kit/03_elbow.stl"),
        file("/home/Vacuum Kit/spare_part.stl"),
      ],
      posixPath,
    );
    const set = groups.find((entry) => entry.isNumberedSet);
    expect(set?.purpose).toBeUndefined();
  });
});

describe("naming a numbered set", () => {
  it("uses the folder name when it is informative", () => {
    const groups = group(
      [
        file("/home/Vacuum Kit/01_adapter.stl"),
        file("/home/Vacuum Kit/02_pipe.stl"),
        file("/home/Vacuum Kit/03_elbow.stl"),
      ],
      posixPath,
    );
    expect(groups[0]?.displayName).toBe("Vacuum Kit");
  });

  it("says the set needs naming when the folder says nothing", () => {
    const groups = group(
      [
        file("/home/Downloads/01_adapter.stl"),
        file("/home/Downloads/02_pipe.stl"),
        file("/home/Downloads/03_elbow.stl"),
      ],
      posixPath,
    );
    expect(groups[0]?.displayName).toBe("Numbered set");
    expect(groups[0]?.isNumberedSet).toBe(true);
  });
});
