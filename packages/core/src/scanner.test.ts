import { describe, expect, it } from "vitest";
import { MemoryFileSystem, type MemorySeedEntry } from "./memoryFileSystem.js";
import { posixPath } from "./posixPath.js";
import { scan } from "./scanner.js";

const LIBRARY = "/lib";

function run(seed: Record<string, MemorySeedEntry>, roots = ["/home"]) {
  return scan({
    fs: new MemoryFileSystem(seed),
    path: posixPath,
    roots,
    libraryRoot: LIBRARY,
  });
}

describe("scan", () => {
  it("collects mesh files and records their metadata", async () => {
    const result = await run({ "/home/models/tower.stl": { content: "x" } });
    expect(result.files).toHaveLength(1);
    const file = result.files[0];
    expect(file?.stem).toBe("tower");
    expect(file?.ext).toBe(".stl");
    expect(file?.kind).toBe("mesh");
    expect(file?.sourceDir).toBe("/home/models");
    expect(file?.size).toBe(1);
  });

  it("lowercases the extension it records", async () => {
    const result = await run({ "/home/m/Tower.STL": { content: "x" } });
    expect(result.files[0]?.ext).toBe(".stl");
    expect(result.files[0]?.stem).toBe("Tower");
  });

  it("ignores extensions it does not collect", async () => {
    const result = await run({ "/home/models/notes.docx": { content: "x" } });
    expect(result.files).toEqual([]);
  });

  it("records the duplicate index when one is present", async () => {
    const result = await run({ "/home/m/tower (3).stl": { content: "x" } });
    expect(result.files[0]?.duplicateIndex).toBe(3);
  });

  it("never descends into an excluded directory", async () => {
    const result = await run({
      "/home/code/node_modules/pkg/model.stl": { content: "x" },
      "/home/models/tower.stl": { content: "y" },
    });
    expect(result.files.map((file) => file.path)).toEqual(["/home/models/tower.stl"]);
  });

  it("never collects from inside the library itself", async () => {
    const result = await run({ "/lib/Terrain/Tower/tower.stl": { content: "x" } }, ["/lib"]);
    expect(result.files).toEqual([]);
  });

  it("walks nested directories to any depth", async () => {
    const result = await run({ "/home/a/b/c/d/e/tower.stl": { content: "x" } });
    expect(result.files).toHaveLength(1);
  });

  it("records a problem and continues when a directory cannot be read", async () => {
    const fs = new MemoryFileSystem({ "/home/ok/tower.stl": { content: "x" } });
    fs.seedDirectory("/home/locked");
    fs.denyRead("/home/locked");
    const result = await scan({ fs, path: posixPath, roots: ["/home"], libraryRoot: LIBRARY });
    expect(result.files).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.stage).toBe("scan");
    expect(result.problems[0]?.path).toBe("/home/locked");
  });

  it("records a problem when a root does not exist", async () => {
    const result = await run({ "/home/tower.stl": { content: "x" } }, ["/home", "/missing"]);
    expect(result.files).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
  });

  it("does not follow symlinks", async () => {
    const fs = new MemoryFileSystem({ "/home/real/tower.stl": { content: "x" } });
    fs.seedSymlink("/home/link", "/home/real");
    const result = await scan({ fs, path: posixPath, roots: ["/home"], libraryRoot: LIBRARY });
    expect(result.files.map((file) => file.path)).toEqual(["/home/real/tower.stl"]);
  });

  it("reports progress as it walks", async () => {
    const seen: number[] = [];
    await scan({
      fs: new MemoryFileSystem({
        "/home/a.stl": { content: "x" },
        "/home/b.stl": { content: "y" },
      }),
      path: posixPath,
      roots: ["/home"],
      libraryRoot: LIBRARY,
      onProgress: (count) => seen.push(count),
    });
    expect(seen.at(-1)).toBe(2);
  });

  it("visits a file only once when roots overlap", async () => {
    const result = await run({ "/home/models/tower.stl": { content: "x" } }, [
      "/home",
      "/home/models",
    ]);
    expect(result.files).toHaveLength(1);
  });

  it("writes nothing to disk", async () => {
    const fs = new MemoryFileSystem({ "/home/m/tower.stl": { content: "x" } });
    const before = fs.snapshot();
    await scan({ fs, path: posixPath, roots: ["/home"], libraryRoot: LIBRARY });
    expect(fs.snapshot()).toEqual(before);
  });
});
