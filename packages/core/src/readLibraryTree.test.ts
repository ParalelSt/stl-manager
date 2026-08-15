import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./memoryFileSystem.js";
import { posixPath } from "./posixPath.js";
import { readLibraryTree } from "./readLibraryTree.js";

describe("readLibraryTree", () => {
  it("reads folders and files from disk", async () => {
    const fs = new MemoryFileSystem({
      "/lib/kit/kit_base.stl": { content: "aaa" },
      "/lib/kit/kit_lip.stl": { content: "bb" },
    });
    const tree = await readLibraryTree(fs, posixPath, "/lib");
    expect(tree.children.map((child) => child.name)).toEqual(["kit"]);
    expect(tree.fileCount).toBe(2);
    expect(tree.totalBytes).toBe(5);
  });

  it("skips the application's own state folder", async () => {
    const fs = new MemoryFileSystem({
      "/lib/kit/kit_base.stl": { content: "a" },
      "/lib/.stl-manager/journal.jsonl": { content: "x" },
    });
    const tree = await readLibraryTree(fs, posixPath, "/lib");
    expect(tree.children.map((child) => child.name)).toEqual(["kit"]);
  });

  it("skips hidden files", async () => {
    const fs = new MemoryFileSystem({
      "/lib/kit/kit_base.stl": { content: "a" },
      "/lib/kit/.DS_Store": { content: "x" },
    });
    const tree = await readLibraryTree(fs, posixPath, "/lib");
    expect(tree.fileCount).toBe(1);
  });

  it("nests folders to any depth", async () => {
    const fs = new MemoryFileSystem({ "/lib/a/b/c/model.stl": { content: "x" } });
    const tree = await readLibraryTree(fs, posixPath, "/lib");
    expect(tree.fileCount).toBe(1);
  });

  it("returns an empty tree for a library that does not exist", async () => {
    const tree = await readLibraryTree(new MemoryFileSystem({}), posixPath, "/nowhere");
    expect(tree.children).toEqual([]);
    expect(tree.fileCount).toBe(0);
  });

  it("sorts folders before files", async () => {
    const fs = new MemoryFileSystem({
      "/lib/zzz.stl": { content: "a" },
      "/lib/aaa/model.stl": { content: "b" },
    });
    const tree = await readLibraryTree(fs, posixPath, "/lib");
    expect(tree.children.map((child) => child.name)).toEqual(["aaa", "zzz.stl"]);
  });
});
