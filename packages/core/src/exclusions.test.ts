import { describe, expect, it } from "vitest";
import { COLLECTED_EXTENSIONS, isExcluded } from "./exclusions.js";
import { posixPath } from "./posixPath.js";

const LIBRARY = "/Users/me/STL Library";

function excluded(path: string): boolean {
  return isExcluded(path, LIBRARY, posixPath);
}

describe("isExcluded", () => {
  it("excludes the library root and its contents", () => {
    expect(excluded(LIBRARY)).toBe(true);
    expect(excluded(`${LIBRARY}/Terrain/Tower`)).toBe(true);
  });

  it("excludes tooling directories", () => {
    expect(excluded("/Users/me/code/node_modules")).toBe(true);
    expect(excluded("/Users/me/code/.git")).toBe(true);
  });

  it("excludes application bundles", () => {
    expect(excluded("/Applications/Blender.app")).toBe(true);
  });

  it("excludes system paths on both platforms", () => {
    expect(excluded("/System/Library")).toBe(true);
    expect(excluded("/proc/self")).toBe(true);
  });

  it("allows an ordinary user directory", () => {
    expect(excluded("/Users/me/Downloads/Terrain Pack")).toBe(false);
  });

  it("does not exclude a directory merely containing the library name", () => {
    expect(excluded("/Users/me/STL Library Backup Notes")).toBe(false);
  });

  it("does not exclude a directory whose name merely starts with a system path", () => {
    expect(excluded("/Systems Design/models")).toBe(false);
  });

  it("does not exclude a file named like an excluded directory", () => {
    expect(excluded("/Users/me/node_modules_notes/tower.stl")).toBe(false);
  });
});

describe("COLLECTED_EXTENSIONS", () => {
  it("classifies mesh formats", () => {
    expect(COLLECTED_EXTENSIONS[".stl"]).toBe("mesh");
    expect(COLLECTED_EXTENSIONS[".3mf"]).toBe("mesh");
  });

  it("classifies slicer formats", () => {
    expect(COLLECTED_EXTENSIONS[".lys"]).toBe("slicer");
    expect(COLLECTED_EXTENSIONS[".ctb"]).toBe("slicer");
  });

  it("classifies companion formats", () => {
    expect(COLLECTED_EXTENSIONS[".jpg"]).toBe("companion");
    expect(COLLECTED_EXTENSIONS[".txt"]).toBe("companion");
  });

  it("does not collect unrelated formats", () => {
    expect(COLLECTED_EXTENSIONS[".docx"]).toBeUndefined();
    expect(COLLECTED_EXTENSIONS[".mp4"]).toBeUndefined();
  });
});
