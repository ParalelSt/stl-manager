import { describe, expect, it } from "vitest";
import { attachCompanions } from "./companions.js";
import type { FileGroup } from "./grouper.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

function model(path: string): ScannedFile {
  const name = path.split("/").at(-1) ?? "";
  return {
    path,
    stem: name.slice(0, name.lastIndexOf(".")),
    ext: ".stl",
    size: 100,
    mtimeMs: 1000,
    birthtimeMs: 1000,
    deviceId: 1,
    sourceDir: path.split("/").slice(0, -1).join("/"),
    duplicateIndex: undefined,
    kind: FILE_KIND.MESH,
  };
}

function companion(path: string): ScannedFile {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return {
    ...model(path),
    stem: name.slice(0, dot),
    ext: name.slice(dot),
    kind: FILE_KIND.COMPANION,
  };
}

function groupWith(nameKey: string, paths: string[]): FileGroup {
  return {
    id: nameKey,
    nameKey,
    displayName: nameKey,
    purpose: undefined,
    files: paths.map((path) => model(path)),
  };
}

describe("attachCompanions", () => {
  it("attaches a companion whose stem matches a model in the same directory", () => {
    const result = attachCompanions(
      [groupWith("tower", ["/a/tower.stl"])],
      [companion("/a/tower.jpg")],
    );
    expect(result.attached.get("tower")?.map((entry) => entry.path)).toEqual(["/a/tower.jpg"]);
    expect(result.untouched).toEqual([]);
  });

  it("attaches an unmatched companion when its directory maps to exactly one group", () => {
    const result = attachCompanions(
      [groupWith("tower", ["/a/tower.stl"])],
      [companion("/a/readme.txt")],
    );
    expect(result.attached.get("tower")?.map((entry) => entry.path)).toEqual(["/a/readme.txt"]);
  });

  it("leaves an unmatched companion alone when its directory maps to several groups", () => {
    const result = attachCompanions(
      [groupWith("tower", ["/a/tower.stl"]), groupWith("wall", ["/a/wall.stl"])],
      [companion("/a/readme.txt")],
    );
    expect(result.attached.size).toBe(0);
    expect(result.untouched.map((entry) => entry.path)).toEqual(["/a/readme.txt"]);
  });

  it("still matches by stem when its directory maps to several groups", () => {
    const result = attachCompanions(
      [groupWith("tower", ["/a/tower.stl"]), groupWith("wall", ["/a/wall.stl"])],
      [companion("/a/tower.jpg")],
    );
    expect(result.attached.get("tower")?.map((entry) => entry.path)).toEqual(["/a/tower.jpg"]);
    expect(result.untouched).toEqual([]);
  });

  it("leaves a companion alone when no model shares its directory", () => {
    const result = attachCompanions(
      [groupWith("tower", ["/a/tower.stl"])],
      [companion("/elsewhere/holiday.jpg")],
    );
    expect(result.untouched.map((entry) => entry.path)).toEqual(["/elsewhere/holiday.jpg"]);
  });

  it("matches a stem that differs only by separators or case", () => {
    const result = attachCompanions(
      [groupWith("space marine", ["/a/space_marine.stl"])],
      [companion("/a/Space-Marine.png")],
    );
    expect(result.attached.get("space marine")).toHaveLength(1);
  });

  it("attaches nothing when there are no groups", () => {
    const result = attachCompanions([], [companion("/a/readme.txt")]);
    expect(result.attached.size).toBe(0);
    expect(result.untouched).toHaveLength(1);
  });
});
