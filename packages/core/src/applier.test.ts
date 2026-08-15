import { describe, expect, it } from "vitest";
import { apply } from "./applier.js";
import type { FileSystem } from "./fileSystem.js";
import { Journal } from "./journal.js";
import { MemoryFileSystem, toPlainFileSystem } from "./memoryFileSystem.js";
import type { PlannedMove, SortPlan } from "./planner.js";
import { posixPath } from "./posixPath.js";

function move(from: string, to: string, size = 1): PlannedMove {
  return { from, to, groupId: "tower", reason: "model", size };
}

function sortPlan(moves: PlannedMove[]): SortPlan {
  return { libraryRoot: "/lib", moves, groups: [], untouched: [], problems: [] };
}

function run(fs: FileSystem, moves: PlannedMove[], memory: MemoryFileSystem) {
  return apply({
    fs,
    path: posixPath,
    plan: sortPlan(moves),
    journal: new Journal(memory, posixPath, "/lib"),
    runId: "run-1",
    now: () => 1000,
  });
}

describe("apply", () => {
  it("moves each planned file to its destination", async () => {
    const fs = new MemoryFileSystem({
      "/home/a.stl": { content: "a" },
      "/home/b.stl": { content: "b" },
    });
    const result = await run(fs, [move("/home/a.stl", "/lib/a/a.stl"), move("/home/b.stl", "/lib/b/b.stl")], fs);

    expect(result.moved).toBe(2);
    expect(await fs.exists("/lib/a/a.stl")).toBe(true);
    expect(await fs.exists("/home/a.stl")).toBe(false);
  });

  it("skips a source whose size changed since the scan and reports it", async () => {
    const fs = new MemoryFileSystem({ "/home/a.stl": { content: "much longer now" } });
    const result = await run(fs, [move("/home/a.stl", "/lib/a/a.stl", 1)], fs);

    expect(result.skipped).toBe(1);
    expect(result.moved).toBe(0);
    expect(await fs.exists("/home/a.stl")).toBe(true);
    expect(result.problems).toHaveLength(1);
  });

  it("skips a source that vanished since the scan", async () => {
    const fs = new MemoryFileSystem({});
    const result = await run(fs, [move("/home/gone.stl", "/lib/a/gone.stl")], fs);

    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("aborts before any write when free space is insufficient", async () => {
    const fs = new MemoryFileSystem({ "/home/a.stl": { content: "a" } }, { freeSpace: 0 });
    const before = fs.snapshot();

    await expect(run(fs, [move("/home/a.stl", "/lib/a/a.stl")], fs)).rejects.toThrow(
      /free space/i,
    );
    expect(fs.snapshot()).toEqual(before);
  });

  it("copies then removes when the filesystem reports a cross-volume move", async () => {
    const fs = new MemoryFileSystem({ "/vol1/a.stl": { content: "a" } });
    const calls: string[] = [];
    const watching: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async () => {
        calls.push("move");
        throw new Error("EXDEV: cross-device link not permitted, rename");
      },
      copy: async (from, to) => {
        calls.push("copy");
        await fs.copy(from, to);
      },
      remove: async (path) => {
        calls.push("remove");
        await fs.remove(path);
      },
    };

    const result = await run(watching, [move("/vol1/a.stl", "/lib/a/a.stl")], fs);

    expect(calls).toEqual(["move", "copy", "remove"]);
    expect(result.moved).toBe(1);
    expect(await fs.exists("/vol1/a.stl")).toBe(false);
    expect(await fs.exists("/lib/a/a.stl")).toBe(true);
  });

  it("does not remove the source when the fallback copy fails", async () => {
    const fs = new MemoryFileSystem({ "/vol1/a.stl": { content: "a" } });
    let removeCalled = false;
    const failing: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async () => {
        throw new Error("EXDEV: cross-device link not permitted, rename");
      },
      copy: async () => {
        throw new Error("disk full");
      },
      remove: async () => {
        removeCalled = true;
      },
    };

    const result = await run(failing, [move("/vol1/a.stl", "/lib/a/a.stl")], fs);

    expect(removeCalled).toBe(false);
    expect(result.failed).toBe(1);
    expect(await fs.exists("/vol1/a.stl")).toBe(true);
  });

  it("does not remove the source when the fallback copy is the wrong size", async () => {
    const fs = new MemoryFileSystem({ "/vol1/a.stl": { content: "abc" } });
    let removeCalled = false;
    const truncating: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async () => {
        throw new Error("EXDEV: cross-device link not permitted, rename");
      },
      copy: async (_from, to) => {
        await fs.appendLine(to, "");
      },
      remove: async () => {
        removeCalled = true;
      },
    };

    const result = await run(truncating, [move("/vol1/a.stl", "/lib/a/a.stl", 3)], fs);

    expect(removeCalled).toBe(false);
    expect(result.failed).toBe(1);
    expect(await fs.exists("/vol1/a.stl")).toBe(true);
  });

  it("rethrows a move failure that is not a cross-volume error", async () => {
    const fs = new MemoryFileSystem({ "/home/a.stl": { content: "a" } });
    let copyCalled = false;
    const failing: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async () => {
        throw new Error("EACCES: permission denied, rename");
      },
      copy: async () => {
        copyCalled = true;
      },
    };

    const result = await run(failing, [move("/home/a.stl", "/lib/a/a.stl")], fs);

    expect(copyCalled).toBe(false);
    expect(result.failed).toBe(1);
  });

  it("continues past a failing file and records the failure", async () => {
    const fs = new MemoryFileSystem({
      "/home/a.stl": { content: "a" },
      "/home/b.stl": { content: "b" },
      "/home/c.stl": { content: "c" },
    });
    const failing: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async (from, to) => {
        if (from === "/home/b.stl") {
          throw new Error("permission denied");
        }
        await fs.move(from, to);
      },
    };

    const result = await run(failing, [
      move("/home/a.stl", "/lib/a.stl"),
      move("/home/b.stl", "/lib/b.stl"),
      move("/home/c.stl", "/lib/c.stl"),
    ], fs);

    expect(result.moved).toBe(2);
    expect(result.failed).toBe(1);
    expect(await fs.exists("/lib/c.stl")).toBe(true);
  });

  it("journals every completed operation as it goes, not at the end", async () => {
    const fs = new MemoryFileSystem({
      "/home/a.stl": { content: "a" },
      "/home/b.stl": { content: "b" },
      "/home/c.stl": { content: "c" },
    });
    const journal = new Journal(fs, posixPath, "/lib");
    const failing: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async (from, to) => {
        if (from === "/home/c.stl") {
          const written = await journal.read("run-1");
          expect(written.filter((item) => item.outcome === "moved")).toHaveLength(2);
        }
        await fs.move(from, to);
      },
    };

    await apply({
      fs: failing,
      path: posixPath,
      plan: sortPlan([
        move("/home/a.stl", "/lib/a.stl"),
        move("/home/b.stl", "/lib/b.stl"),
        move("/home/c.stl", "/lib/c.stl"),
      ]),
      journal,
      runId: "run-1",
      now: () => 1000,
    });
  });

  it("records a failed operation in the journal", async () => {
    const fs = new MemoryFileSystem({ "/home/a.stl": { content: "a" } });
    const journal = new Journal(fs, posixPath, "/lib");
    const failing: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async () => {
        throw new Error("permission denied");
      },
    };

    await apply({
      fs: failing,
      path: posixPath,
      plan: sortPlan([move("/home/a.stl", "/lib/a.stl")]),
      journal,
      runId: "run-1",
      now: () => 1000,
    });

    const entries = await journal.read("run-1");
    expect(entries[0]).toMatchObject({ outcome: "failed", error: "permission denied" });
  });

  it("reports progress for every operation", async () => {
    const fs = new MemoryFileSystem({
      "/home/a.stl": { content: "a" },
      "/home/b.stl": { content: "b" },
    });
    const seen: number[] = [];

    await apply({
      fs,
      path: posixPath,
      plan: sortPlan([move("/home/a.stl", "/lib/a.stl"), move("/home/b.stl", "/lib/b.stl")]),
      journal: new Journal(fs, posixPath, "/lib"),
      runId: "run-1",
      now: () => 1000,
      onProgress: (done) => seen.push(done),
    });

    expect(seen).toEqual([1, 2]);
  });

  it("creates the destination directory before moving into it", async () => {
    const fs = new MemoryFileSystem({ "/home/a.stl": { content: "a" } });
    await run(fs, [move("/home/a.stl", "/lib/Terrain/tower/a.stl")], fs);
    expect(await fs.exists("/lib/Terrain/tower/a.stl")).toBe(true);
  });
});
