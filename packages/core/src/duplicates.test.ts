import { describe, expect, it } from "vitest";
import { resolveDuplicates, selectWinner } from "./duplicates.js";
import { MemoryFileSystem, toPlainFileSystem } from "./memoryFileSystem.js";
import type { FileSystem } from "./fileSystem.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

function file(path: string, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path,
    stem: "tower",
    ext: ".stl",
    size: 100,
    mtimeMs: 1000,
    birthtimeMs: 1000,
    deviceId: 1,
    sourceDir: "/a",
    duplicateIndex: undefined,
    kind: FILE_KIND.MESH,
    ...overrides,
  };
}

describe("selectWinner", () => {
  it("prefers the highest duplicate index", () => {
    const winner = selectWinner([
      file("/a/tower.stl"),
      file("/a/tower (3).stl", { duplicateIndex: 3 }),
      file("/a/tower (1).stl", { duplicateIndex: 1 }),
    ]);
    expect(winner.path).toBe("/a/tower (3).stl");
  });

  it("prefers the newest file when no index is present", () => {
    const winner = selectWinner([
      file("/a/tower.stl", { birthtimeMs: 1000 }),
      file("/b/tower.stl", { birthtimeMs: 5000 }),
    ]);
    expect(winner.path).toBe("/b/tower.stl");
  });

  it("breaks an index tie with the newest file", () => {
    const winner = selectWinner([
      file("/a/tower (2).stl", { duplicateIndex: 2, birthtimeMs: 1000 }),
      file("/b/tower (2).stl", { duplicateIndex: 2, birthtimeMs: 5000 }),
    ]);
    expect(winner.path).toBe("/b/tower (2).stl");
  });

  it("falls back to modification time when creation time is missing", () => {
    const winner = selectWinner([
      file("/a/tower.stl", { birthtimeMs: 0, mtimeMs: 1000 }),
      file("/b/tower.stl", { birthtimeMs: 0, mtimeMs: 5000 }),
    ]);
    expect(winner.path).toBe("/b/tower.stl");
  });

  it("is deterministic when everything ties", () => {
    const candidates = [file("/b/tower.stl"), file("/a/tower.stl")];
    expect(selectWinner(candidates).path).toBe(selectWinner([...candidates].reverse()).path);
  });
});

describe("resolveDuplicates", () => {
  it("treats byte-identical files as duplicates of the winner", async () => {
    const fs = new MemoryFileSystem({
      "/a/tower.stl": { content: "same" },
      "/a/tower (2).stl": { content: "same" },
    });
    const result = await resolveDuplicates(
      [
        file("/a/tower.stl", { size: 4 }),
        file("/a/tower (2).stl", { duplicateIndex: 2, size: 4 }),
      ],
      fs,
    );
    expect(result.winner.path).toBe("/a/tower (2).stl");
    expect(result.identical.map((entry) => entry.path)).toEqual(["/a/tower.stl"]);
    expect(result.divergent).toEqual([]);
  });

  it("keeps files whose contents differ despite the matching name", async () => {
    const fs = new MemoryFileSystem({
      "/a/tower.stl": { content: "original" },
      "/a/tower (2).stl": { content: "quite different" },
    });
    const result = await resolveDuplicates(
      [
        file("/a/tower.stl", { size: 8 }),
        file("/a/tower (2).stl", { duplicateIndex: 2, size: 15 }),
      ],
      fs,
    );
    expect(result.divergent.map((entry) => entry.path)).toEqual(["/a/tower.stl"]);
    expect(result.identical).toEqual([]);
  });

  it("detects a difference between same-sized files of different content", async () => {
    const fs = new MemoryFileSystem({
      "/a/tower.stl": { content: "aaaa" },
      "/a/tower (2).stl": { content: "bbbb" },
    });
    const result = await resolveDuplicates(
      [
        file("/a/tower.stl", { size: 4 }),
        file("/a/tower (2).stl", { duplicateIndex: 2, size: 4 }),
      ],
      fs,
    );
    expect(result.divergent.map((entry) => entry.path)).toEqual(["/a/tower.stl"]);
  });

  it("does not hash files whose sizes already differ", async () => {
    const fs = new MemoryFileSystem({
      "/a/tower.stl": { content: "a" },
      "/a/tower (2).stl": { content: "bb" },
    });
    let hashCalls = 0;
    const counting: FileSystem = {
      ...toPlainFileSystem(fs),
      hash: async (path: string): Promise<string> => {
        hashCalls += 1;
        return fs.hash(path);
      },
    };
    await resolveDuplicates(
      [
        file("/a/tower.stl", { size: 1 }),
        file("/a/tower (2).stl", { duplicateIndex: 2, size: 2 }),
      ],
      counting,
    );
    expect(hashCalls).toBe(0);
  });

  it("returns the only file as the winner when there is nothing to compare", async () => {
    const fs = new MemoryFileSystem({ "/a/tower.stl": { content: "x" } });
    const result = await resolveDuplicates([file("/a/tower.stl")], fs);
    expect(result.winner.path).toBe("/a/tower.stl");
    expect(result.identical).toEqual([]);
    expect(result.divergent).toEqual([]);
  });

  it("treats a file it cannot read as divergent rather than discarding it", async () => {
    const fs = new MemoryFileSystem({ "/a/tower (2).stl": { content: "x" } });
    const result = await resolveDuplicates(
      [
        file("/a/gone.stl", { size: 1 }),
        file("/a/tower (2).stl", { duplicateIndex: 2, size: 1 }),
      ],
      fs,
    );
    expect(result.divergent.map((entry) => entry.path)).toEqual(["/a/gone.stl"]);
    expect(result.identical).toEqual([]);
  });

  it("compares every loser against the winner, not against each other", async () => {
    const fs = new MemoryFileSystem({
      "/a/tower.stl": { content: "same" },
      "/a/tower (1).stl": { content: "other" },
      "/a/tower (2).stl": { content: "same" },
    });
    const result = await resolveDuplicates(
      [
        file("/a/tower.stl", { size: 4 }),
        file("/a/tower (1).stl", { duplicateIndex: 1, size: 5 }),
        file("/a/tower (2).stl", { duplicateIndex: 2, size: 4 }),
      ],
      fs,
    );
    expect(result.winner.path).toBe("/a/tower (2).stl");
    expect(result.identical.map((entry) => entry.path)).toEqual(["/a/tower.stl"]);
    expect(result.divergent.map((entry) => entry.path)).toEqual(["/a/tower (1).stl"]);
  });
});
