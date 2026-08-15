import { describe, expect, it } from "vitest";
import {
  isValidGroupName,
  mergeGroups,
  moveModelToGroup,
  renameGroup,
  setExcluded,
  setPurpose,
  splitGroup,
} from "./planEditor.js";
import { deriveMoves, type GroupPlan, type PlanModel } from "./planner.js";
import { posixPath } from "./posixPath.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

function file(path: string, ext = ".stl"): ScannedFile {
  const name = path.split("/").at(-1) ?? "";
  return {
    path,
    stem: name.slice(0, name.lastIndexOf(".")),
    ext,
    size: 10,
    mtimeMs: 1000,
    birthtimeMs: 1000,
    deviceId: 1,
    sourceDir: path.split("/").slice(0, -1).join("/"),
    duplicateIndex: undefined,
    kind: FILE_KIND.MESH,
  };
}

function group(id: string, overrides: Partial<GroupPlan> = {}): GroupPlan {
  return {
    id,
    displayName: id,
    purpose: undefined,
    kept: [file(`/home/M/${id}.stl`)],
    duplicates: [],
    companions: [],
    isNumberedSet: false,
    isExcluded: false,
    ...overrides,
  };
}

function model(groups: GroupPlan[]): PlanModel {
  return { libraryRoot: "/lib", scanRoots: ["/home"], groups, untouched: [], problems: [] };
}

function destinations(edited: PlanModel): string[] {
  return deriveMoves(edited, posixPath).map((entry) => entry.to);
}

describe("isValidGroupName", () => {
  it("accepts an ordinary name", () => {
    expect(isValidGroupName("Space Marine")).toBe(true);
  });

  it("rejects a name that is empty or only whitespace", () => {
    expect(isValidGroupName("")).toBe(false);
    expect(isValidGroupName("   ")).toBe(false);
  });

  it("rejects a name containing a path separator", () => {
    expect(isValidGroupName("Terrain/Tower")).toBe(false);
    expect(isValidGroupName("Terrain\\Tower")).toBe(false);
  });

  it("rejects the directory shorthands", () => {
    expect(isValidGroupName(".")).toBe(false);
    expect(isValidGroupName("..")).toBe(false);
  });
});

describe("renameGroup", () => {
  it("moves the folder, keeping each file's own name", () => {
    // Renaming a family renames its folder. The models inside keep their own
    // names, because a family holds several distinct models.
    const edited = renameGroup(model([group("tower")]), "tower", "Ruined Tower");
    expect(destinations(edited)).toEqual(["/lib/Ruined Tower/tower.stl"]);
  });

  it("trims the name it is given", () => {
    const edited = renameGroup(model([group("tower")]), "tower", "  Tower  ");
    expect(destinations(edited)).toEqual(["/lib/Tower/tower.stl"]);
  });

  it("leaves the model untouched when the name is unusable", () => {
    const original = model([group("tower")]);
    expect(renameGroup(original, "tower", "  ")).toBe(original);
    expect(renameGroup(original, "tower", "a/b")).toBe(original);
  });

  it("does not touch other groups", () => {
    const edited = renameGroup(model([group("tower"), group("wall")]), "tower", "Tower");
    expect(destinations(edited)).toContain("/lib/wall/wall.stl");
  });
});

describe("setPurpose", () => {
  it("moves the group under the named parent", () => {
    const edited = setPurpose(model([group("tower")]), "tower", "Terrain");
    expect(destinations(edited)).toEqual(["/lib/Terrain/tower/tower.stl"]);
  });

  it("moves the group to the library root when cleared", () => {
    const withPurpose = model([group("tower", { purpose: "Terrain" })]);
    const edited = setPurpose(withPurpose, "tower", undefined);
    expect(destinations(edited)).toEqual(["/lib/tower/tower.stl"]);
  });

  it("leaves the model untouched when the purpose is unusable", () => {
    const original = model([group("tower")]);
    expect(setPurpose(original, "tower", "a/b")).toBe(original);
  });
});

describe("setExcluded", () => {
  it("removes every move belonging to the group", () => {
    const edited = setExcluded(model([group("tower"), group("wall")]), "tower", true);
    expect(destinations(edited)).toEqual(["/lib/wall/wall.stl"]);
  });

  it("keeps the group in the model so it can still be shown", () => {
    const edited = setExcluded(model([group("tower")]), "tower", true);
    expect(edited.groups).toHaveLength(1);
    expect(edited.groups[0]?.isExcluded).toBe(true);
  });

  it("does not quarantine duplicates of an excluded group", () => {
    const withDuplicate = model([
      group("tower", { duplicates: [file("/home/M/tower (1).stl")] }),
    ]);
    expect(destinations(setExcluded(withDuplicate, "tower", true))).toEqual([]);
  });

  it("brings the group back when cleared", () => {
    const excluded = setExcluded(model([group("tower")]), "tower", true);
    expect(destinations(setExcluded(excluded, "tower", false))).toHaveLength(1);
  });
});

describe("mergeGroups", () => {
  it("puts every file under the target group, each keeping its name", () => {
    const edited = mergeGroups(model([group("tower"), group("wall")]), "wall", "tower");
    expect(destinations(edited).sort()).toEqual(["/lib/tower/tower.stl", "/lib/tower/wall.stl"]);
  });

  it("leaves no trace of the absorbed group", () => {
    const edited = mergeGroups(model([group("tower"), group("wall")]), "wall", "tower");
    expect(edited.groups.map((entry) => entry.id)).toEqual(["tower"]);
  });

  it("carries duplicates and companions across", () => {
    const source = group("wall", {
      duplicates: [file("/home/M/wall (1).stl")],
      companions: [file("/home/M/wall.jpg", ".jpg")],
    });
    const edited = mergeGroups(model([group("tower"), source]), "wall", "tower");
    const merged = edited.groups[0];
    expect(merged?.duplicates).toHaveLength(1);
    expect(merged?.companions).toHaveLength(1);
  });

  it("keeps the target's own name and purpose", () => {
    const target = group("tower", { displayName: "Tower", purpose: "Terrain" });
    const edited = mergeGroups(model([target, group("wall")]), "wall", "tower");
    expect(edited.groups[0]).toMatchObject({ displayName: "Tower", purpose: "Terrain" });
  });

  it("leaves the model untouched when a group is unknown or merged into itself", () => {
    const original = model([group("tower")]);
    expect(mergeGroups(original, "tower", "tower")).toBe(original);
    expect(mergeGroups(original, "nope", "tower")).toBe(original);
    expect(mergeGroups(original, "tower", "nope")).toBe(original);
  });
});

describe("splitGroup", () => {
  it("produces one group per source directory", () => {
    const mixed = group("base", {
      kept: [file("/home/A/base.stl"), file("/home/B/base.stl")],
    });
    const edited = splitGroup(model([mixed]), "base");
    expect(edited.groups).toHaveLength(2);
  });

  it("keeps every file, losing none", () => {
    const mixed = group("base", {
      kept: [file("/home/A/base.stl"), file("/home/B/base.stl")],
      companions: [file("/home/A/base.jpg", ".jpg")],
    });
    const edited = splitGroup(model([mixed]), "base");
    const total = edited.groups.reduce(
      (count, entry) => count + entry.kept.length + entry.companions.length,
      0,
    );
    expect(total).toBe(3);
  });

  it("gives the pieces distinct destinations", () => {
    const mixed = group("base", {
      kept: [file("/home/A/base.stl"), file("/home/B/base.stl")],
    });
    const paths = destinations(splitGroup(model([mixed]), "base"));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("leaves the model untouched when every file came from one directory", () => {
    const original = model([group("tower")]);
    expect(splitGroup(original, "tower")).toBe(original);
  });

  it("leaves the model untouched when the group is unknown", () => {
    const original = model([group("tower")]);
    expect(splitGroup(original, "nope")).toBe(original);
  });
});

describe("editing in sequence", () => {
  it("never produces two moves to the same destination", () => {
    let edited = model([group("tower"), group("wall"), group("gate")]);
    edited = renameGroup(edited, "wall", "tower");
    edited = mergeGroups(edited, "gate", "tower");
    edited = setPurpose(edited, "wall", "Terrain");

    const paths = destinations(edited);
    const lowered = paths.map((entry) => entry.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("survives renaming two groups to the same name", () => {
    let edited = model([group("a"), group("b")]);
    edited = renameGroup(edited, "a", "Same");
    edited = renameGroup(edited, "b", "Same");

    // Both folders are called Same, and the files keep their own names, so
    // they simply share the folder rather than colliding.
    expect(destinations(edited).sort()).toEqual(["/lib/Same/a.stl", "/lib/Same/b.stl"]);
  });
});

describe("moveModelToGroup", () => {
  it("moves a model into another family, alongside what is already there", () => {
    const edited = moveModelToGroup(model([group("kit"), group("tower")]), "tower", "kit");
    expect(destinations(edited).sort()).toEqual(["/lib/kit/kit.stl", "/lib/kit/tower.stl"]);
  });

  it("removes a family left with nothing", () => {
    const edited = moveModelToGroup(model([group("kit"), group("tower")]), "tower", "kit");
    expect(edited.groups.map((entry) => entry.id)).toEqual(["kit"]);
  });

  it("keeps a family that still has other models", () => {
    const source = group("pair", {
      kept: [file("/home/M/pair_a.stl"), file("/home/M/pair_b.stl")],
    });
    const edited = moveModelToGroup(model([group("kit"), source]), "pair a", "kit");
    expect(edited.groups.map((entry) => entry.id).sort()).toEqual(["kit", "pair"]);
  });

  it("takes every file belonging to the model, not just the mesh", () => {
    const source = group("tower", {
      kept: [file("/home/M/tower.stl")],
      companions: [file("/home/M/tower.jpg", ".jpg")],
      duplicates: [file("/home/M/tower (1).stl")],
    });
    const edited = moveModelToGroup(model([group("kit"), source]), "tower", "kit");
    const kit = edited.groups.find((entry) => entry.id === "kit");
    expect(kit?.kept).toHaveLength(2);
    expect(kit?.companions).toHaveLength(1);
    expect(kit?.duplicates).toHaveLength(1);
  });

  it("loses no files at all", () => {
    const before = model([
      group("kit", { kept: [file("/home/M/kit_base.stl")] }),
      group("tower", { kept: [file("/home/M/tower.stl")] }),
    ]);
    const after = moveModelToGroup(before, "tower", "kit");
    const count = (entry: PlanModel) =>
      entry.groups.reduce((total, g) => total + g.kept.length + g.companions.length + g.duplicates.length, 0);
    expect(count(after)).toBe(count(before));
  });

  it("leaves the model untouched when the target is unknown", () => {
    const original = model([group("kit"), group("tower")]);
    expect(moveModelToGroup(original, "tower", "nope")).toBe(original);
  });

  it("leaves the model untouched when the model is unknown", () => {
    const original = model([group("kit"), group("tower")]);
    expect(moveModelToGroup(original, "nothing", "kit")).toBe(original);
  });

  it("never produces two files on one path", () => {
    const edited = moveModelToGroup(
      model([group("kit"), group("tower", { kept: [file("/home/M/tower.stl")] })]),
      "tower",
      "kit",
    );
    const paths = destinations(edited);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
