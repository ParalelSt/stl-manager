import { describe, expect, it } from "vitest";
import { group } from "./grouper.js";
import { posixPath } from "./posixPath.js";
import { SORTING_PROFILE, isSortingProfile } from "./sortingProfile.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

function file(path: string, overrides: Partial<ScannedFile> = {}): ScannedFile {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return {
    path,
    stem,
    ext: dot > 0 ? name.slice(dot) : "",
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

/** Renders each group as the folder path it would produce. */
function folders(groups: { displayName: string; purpose: string | undefined }[]): string[] {
  return groups
    .map((entry) =>
      entry.purpose === undefined ? entry.displayName : `${entry.purpose}/${entry.displayName}`,
    )
    .sort();
}

/** A camshaft in three grades, which is the shape a real collection takes. */
const CAMSHAFT = [
  file("/home/Camshaft/cam_v1_mild.stl"),
  file("/home/Camshaft/cam_v1_high.stl"),
  file("/home/Camshaft/cam_v2_mild.stl"),
];

describe("grouping by family", () => {
  it("gathers models sharing a first word into one folder", () => {
    const groups = group(CAMSHAFT, posixPath, SORTING_PROFILE.FAMILY);
    expect(folders(groups)).toEqual(["cam"]);
  });

  it("does not make a parent of a folder that held a single family", () => {
    const groups = group(CAMSHAFT, posixPath, SORTING_PROFILE.FAMILY);
    expect(groups[0]?.purpose).toBeUndefined();
  });

  it("is what a plan gets when no layout is named", () => {
    expect(group(CAMSHAFT, posixPath)).toEqual(group(CAMSHAFT, posixPath, SORTING_PROFILE.FAMILY));
  });
});

describe("grouping by name", () => {
  it("gives every distinct name its own folder", () => {
    const groups = group(CAMSHAFT, posixPath, SORTING_PROFILE.NAME);
    expect(folders(groups)).toEqual(["cam_v1_high", "cam_v1_mild", "cam_v2_mild"]);
  });

  it("still keeps copies of one name together", () => {
    const groups = group(
      [file("/a/tower.stl"), file("/b/tower (1).stl")],
      posixPath,
      SORTING_PROFILE.NAME,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files).toHaveLength(2);
  });

  it("never nests a folder under a parent", () => {
    const groups = group(
      [file("/home/Terrain/tower.stl"), file("/home/Terrain/barricade.stl")],
      posixPath,
      SORTING_PROFILE.NAME,
    );
    expect(groups.map((entry) => entry.purpose)).toEqual([undefined, undefined]);
  });
});

describe("grouping by source folder", () => {
  it("keeps a family under the folder it came from", () => {
    const groups = group(CAMSHAFT, posixPath, SORTING_PROFILE.SOURCE);
    expect(folders(groups)).toEqual(["Camshaft/cam"]);
  });

  it("still refuses a folder name that only says where files landed", () => {
    const groups = group(
      [file("/home/Downloads/cam_mild.stl"), file("/home/Downloads/cam_high.stl")],
      posixPath,
      SORTING_PROFILE.SOURCE,
    );
    expect(folders(groups)).toEqual(["cam"]);
  });
});

describe("grouping by file type", () => {
  it("files each family under the type it mostly consists of", () => {
    const groups = group(
      [file("/home/Camshaft/cam_mild.stl"), file("/home/Parts/gear.obj")],
      posixPath,
      SORTING_PROFILE.TYPE,
    );
    expect(folders(groups)).toEqual(["OBJ/gear", "STL/cam_mild"]);
  });

  it("lets the models decide the type rather than a readme beside them", () => {
    const groups = group(
      [
        file("/home/Kit/gear.stl"),
        file("/home/Kit/gear.txt", { kind: FILE_KIND.COMPANION }),
        file("/home/Kit/gear.jpg", { kind: FILE_KIND.COMPANION }),
      ],
      posixPath,
      SORTING_PROFILE.TYPE,
    );
    expect(folders(groups)).toEqual(["STL/gear"]);
  });
});

describe("isSortingProfile", () => {
  it("accepts a layout the application offers", () => {
    expect(isSortingProfile("family")).toBe(true);
  });

  it("rejects anything else, since layouts arrive from stored settings", () => {
    expect(isSortingProfile("../../etc")).toBe(false);
  });
});
