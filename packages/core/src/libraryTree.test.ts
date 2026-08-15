import { describe, expect, it } from "vitest";
import { buildLibraryTree, type TreeFolder } from "./libraryTree.js";
import { setExcluded } from "./planEditor.js";
import type { GroupPlan, PlanModel } from "./planner.js";
import { posixPath } from "./posixPath.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

function file(path: string, size = 100, ext = ".stl"): ScannedFile {
  const name = path.split("/").at(-1) ?? "";
  return {
    path,
    stem: name.slice(0, name.lastIndexOf(".")),
    ext,
    size,
    mtimeMs: 1000,
    birthtimeMs: 1000,
    deviceId: 1,
    sourceDir: path.split("/").slice(0, -1).join("/"),
    duplicateIndex: undefined,
    kind: ext === ".jpg" ? FILE_KIND.COMPANION : FILE_KIND.MESH,
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

function names(folder: TreeFolder): string[] {
  return folder.children.map((child) => child.name).sort();
}

function findFolder(folder: TreeFolder, name: string): TreeFolder | undefined {
  for (const child of folder.children) {
    if (child.kind === "folder") {
      if (child.name === name) {
        return child;
      }
      const found = findFolder(child, name);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

describe("buildLibraryTree", () => {
  it("puts a family's files inside a folder named after it", () => {
    const tree = buildLibraryTree(model([group("kit")]), posixPath);
    const kit = findFolder(tree.root, "kit");
    expect(kit?.children.map((child) => child.name)).toEqual(["kit.stl"]);
  });

  it("nests a family under its purpose", () => {
    const tree = buildLibraryTree(model([group("tower", { purpose: "Terrain" })]), posixPath);
    expect(names(tree.root)).toEqual(["Terrain"]);
    expect(findFolder(tree.root, "Terrain")?.children[0]?.name).toBe("tower");
  });

  it("puts two families under one shared purpose", () => {
    const tree = buildLibraryTree(
      model([group("tower", { purpose: "Terrain" }), group("wall", { purpose: "Terrain" })]),
      posixPath,
    );
    expect(names(tree.root)).toEqual(["Terrain"]);
    expect(names(findFolder(tree.root, "Terrain") as TreeFolder)).toEqual(["tower", "wall"]);
  });

  it("counts files recursively up the tree", () => {
    const tree = buildLibraryTree(
      model([
        group("tower", { purpose: "Terrain" }),
        group("wall", { purpose: "Terrain", kept: [file("/home/M/wall.stl"), file("/home/M/wall.obj", 100, ".obj")] }),
      ]),
      posixPath,
    );
    expect(findFolder(tree.root, "Terrain")?.fileCount).toBe(3);
    expect(tree.root.fileCount).toBe(3);
  });

  it("sums sizes recursively up the tree", () => {
    const tree = buildLibraryTree(
      model([group("a", { kept: [file("/home/M/a.stl", 250)] }), group("b", { kept: [file("/home/M/b.stl", 750)] })]),
      posixPath,
    );
    expect(tree.root.totalBytes).toBe(1000);
  });

  it("marks the folder that belongs to a family", () => {
    const tree = buildLibraryTree(model([group("kit")]), posixPath);
    expect(findFolder(tree.root, "kit")?.groupId).toBe("kit");
  });

  it("does not mark a purpose folder as belonging to a family", () => {
    const tree = buildLibraryTree(model([group("tower", { purpose: "Terrain" })]), posixPath);
    expect(findFolder(tree.root, "Terrain")?.groupId).toBeUndefined();
  });

  it("puts quarantined duplicates under the quarantine folder", () => {
    const tree = buildLibraryTree(
      model([group("tower", { duplicates: [file("/home/M/tower (1).stl")] })]),
      posixPath,
    );
    expect(names(tree.root)).toContain("_Duplicates");
  });

  it("carries the reason a file is being moved", () => {
    const tree = buildLibraryTree(
      model([group("tower", { companions: [file("/home/M/tower.jpg", 10, ".jpg")] })]),
      posixPath,
    );
    const tower = findFolder(tree.root, "tower");
    const companion = tower?.children.find((child) => child.name === "tower.jpg");
    expect(companion?.kind).toBe("file");
    if (companion?.kind === "file") {
      expect(companion.reason).toBe("companion");
    }
  });

  it("lists an excluded family separately rather than in the tree", () => {
    const excluded = setExcluded(model([group("tower"), group("wall")]), "tower", true);
    const tree = buildLibraryTree(excluded, posixPath);
    expect(names(tree.root)).toEqual(["wall"]);
    expect(tree.excluded.map((entry) => entry.displayName)).toEqual(["tower"]);
  });

  it("reports how many files an excluded family would have moved", () => {
    const excluded = setExcluded(
      model([group("tower", { kept: [file("/home/M/tower.stl"), file("/home/M/tower.obj", 100, ".obj")] })]),
      "tower",
      true,
    );
    expect(buildLibraryTree(excluded, posixPath).excluded[0]?.fileCount).toBe(2);
  });

  it("returns an empty tree when everything is excluded", () => {
    const excluded = setExcluded(model([group("tower")]), "tower", true);
    const tree = buildLibraryTree(excluded, posixPath);
    expect(tree.root.children).toEqual([]);
    expect(tree.root.fileCount).toBe(0);
  });

  it("sorts folders before files", () => {
    // A family whose folder is the library root itself puts files beside
    // folders, which is the only case where the ordering matters.
    const tree = buildLibraryTree(
      model([group("zeta", { purpose: "Parent" }), group("alpha", { purpose: "Parent" })]),
      posixPath,
    );
    const parent = findFolder(tree.root, "Parent") as TreeFolder;
    expect(parent.children.every((child) => child.kind === "folder")).toBe(true);
    expect(parent.children.map((child) => child.name)).toEqual(["alpha", "zeta"]);
  });

  it("sorts case-insensitively, the way a file browser does", () => {
    const tree = buildLibraryTree(
      model([group("zeta"), group("alpha"), group("mid", { purpose: "Parent" })]),
      posixPath,
    );
    expect(tree.root.children.map((child) => child.name)).toEqual(["alpha", "Parent", "zeta"]);
  });

  it("names the root after the library folder", () => {
    const tree = buildLibraryTree(model([group("kit")]), posixPath);
    expect(tree.root.name).toBe("lib");
    expect(tree.root.path).toBe("/lib");
  });

  it("gives every file its real destination path", () => {
    const tree = buildLibraryTree(model([group("kit", { purpose: "Sets" })]), posixPath);
    const kit = findFolder(tree.root, "kit");
    const first = kit?.children[0];
    expect(first?.path).toBe("/lib/Sets/kit/kit.stl");
  });
});

describe("ordering the quarantine folder", () => {
  it("sorts the quarantine folder last, despite its underscore", () => {
    const tree = buildLibraryTree(
      model([
        group("2853", { duplicates: [file("/home/M/2853 (1).stl")] }),
        group("kit"),
      ]),
      posixPath,
    );
    expect(tree.root.children.map((child) => child.name)).toEqual(["2853", "kit", "_Duplicates"]);
  });
});
