import { describe, expect, it } from "vitest";
import type { FileSystem } from "./fileSystem.js";
import { Journal, type JournalEntry } from "./journal.js";
import { MemoryFileSystem, toPlainFileSystem } from "./memoryFileSystem.js";
import { posixPath } from "./posixPath.js";
import { undo } from "./undo.js";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    runId: "run-1",
    at: 1000,
    from: "/home/M/tower.stl",
    to: "/lib/tower/tower.stl",
    reason: "model",
    outcome: "moved",
    ...overrides,
  };
}

describe("undo", () => {
  it("returns every file to its original location", async () => {
    const fs = new MemoryFileSystem({ "/lib/tower/tower.stl": { content: "x" } });
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry());

    const result = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(await fs.exists("/home/M/tower.stl")).toBe(true);
    expect(await fs.exists("/lib/tower/tower.stl")).toBe(false);
    expect(result.restored).toBe(1);
  });

  it("processes entries in reverse order", async () => {
    const fs = new MemoryFileSystem({
      "/lib/a.stl": { content: "a" },
      "/lib/b.stl": { content: "b" },
      "/lib/c.stl": { content: "c" },
    });
    const order: string[] = [];
    const recording: FileSystem = {
      ...toPlainFileSystem(fs),
      move: async (from: string, to: string): Promise<void> => {
        order.push(from);
        await fs.move(from, to);
      },
    };

    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry({ from: "/home/a.stl", to: "/lib/a.stl" }));
    await journal.append(entry({ from: "/home/b.stl", to: "/lib/b.stl" }));
    await journal.append(entry({ from: "/home/c.stl", to: "/lib/c.stl" }));

    await undo({ fs: recording, path: posixPath, journal, runId: "run-1" });

    expect(order).toEqual(["/lib/c.stl", "/lib/b.stl", "/lib/a.stl"]);
  });

  it("skips an entry whose destination no longer exists and reports it", async () => {
    const fs = new MemoryFileSystem({});
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry());

    const result = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(result.restored).toBe(0);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.stage).toBe("undo");
  });

  it("does not restore entries whose outcome was failed", async () => {
    const fs = new MemoryFileSystem({});
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry({ outcome: "failed", error: "permission denied" }));

    const result = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(result.restored).toBe(0);
    expect(result.problems).toEqual([]);
  });

  it("refuses to overwrite a file that now occupies the original location", async () => {
    const fs = new MemoryFileSystem({
      "/lib/tower/tower.stl": { content: "moved" },
      "/home/M/tower.stl": { content: "something new" },
    });
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry());

    const result = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(result.problems).toHaveLength(1);
    expect(result.restored).toBe(0);
    expect(await fs.readLines("/home/M/tower.stl")).toEqual(["something new"]);
    expect(await fs.exists("/lib/tower/tower.stl")).toBe(true);
  });

  it("restores a copied operation the same way as a moved one", async () => {
    const fs = new MemoryFileSystem({ "/lib/tower/tower.stl": { content: "x" } });
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry({ outcome: "copied" }));

    const result = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(result.restored).toBe(1);
    expect(await fs.exists("/home/M/tower.stl")).toBe(true);
  });

  it("continues past a failure and restores the rest", async () => {
    const fs = new MemoryFileSystem({ "/lib/b.stl": { content: "b" } });
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry({ from: "/home/a.stl", to: "/lib/a.stl" }));
    await journal.append(entry({ from: "/home/b.stl", to: "/lib/b.stl" }));

    const result = await undo({ fs, path: posixPath, journal, runId: "run-1" });

    expect(result.restored).toBe(1);
    expect(result.problems).toHaveLength(1);
    expect(await fs.exists("/home/b.stl")).toBe(true);
  });

  it("reports progress as it restores", async () => {
    const fs = new MemoryFileSystem({ "/lib/tower/tower.stl": { content: "x" } });
    const journal = new Journal(fs, posixPath, "/lib");
    await journal.append(entry());

    const seen: number[] = [];
    await undo({
      fs,
      path: posixPath,
      journal,
      runId: "run-1",
      onProgress: (done) => seen.push(done),
    });

    expect(seen.at(-1)).toBe(1);
  });
});
