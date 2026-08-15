import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "./memoryFileSystem.js";

describe("MemoryFileSystem", () => {
  it("lists files it was seeded with", async () => {
    const fs = new MemoryFileSystem({ "/a/b.stl": { content: "x" } });
    const entries = await fs.list("/a");
    expect(entries.map((entry) => entry.name)).toEqual(["b.stl"]);
  });

  it("marks an implied parent directory as a directory", async () => {
    const fs = new MemoryFileSystem({ "/a/nested/b.stl": { content: "x" } });
    const entries = await fs.list("/a");
    expect(entries).toEqual([
      { name: "nested", path: "/a/nested", isDirectory: true, isSymbolicLink: false },
    ]);
  });

  it("rejects when listing a directory that does not exist", async () => {
    const fs = new MemoryFileSystem({});
    await expect(fs.list("/nowhere")).rejects.toThrow();
  });

  it("moves a file so the source no longer exists", async () => {
    const fs = new MemoryFileSystem({ "/a/b.stl": { content: "x" } });
    await fs.move("/a/b.stl", "/c/b.stl");
    expect(await fs.exists("/a/b.stl")).toBe(false);
    expect(await fs.exists("/c/b.stl")).toBe(true);
  });

  it("copies a file leaving the source in place", async () => {
    const fs = new MemoryFileSystem({ "/a/b.stl": { content: "x" } });
    await fs.copy("/a/b.stl", "/c/b.stl");
    expect(await fs.exists("/a/b.stl")).toBe(true);
    expect(await fs.hash("/a/b.stl")).toBe(await fs.hash("/c/b.stl"));
  });

  it("gives identical content identical hashes", async () => {
    const fs = new MemoryFileSystem({
      "/a.stl": { content: "same" },
      "/b.stl": { content: "same" },
      "/c.stl": { content: "different" },
    });
    expect(await fs.hash("/a.stl")).toBe(await fs.hash("/b.stl"));
    expect(await fs.hash("/a.stl")).not.toBe(await fs.hash("/c.stl"));
  });

  it("reads a chunk at an offset", async () => {
    const fs = new MemoryFileSystem({ "/a.stl": { content: "abcdefgh" } });
    const chunk = await fs.readChunk("/a.stl", 2, 3);
    expect(new TextDecoder().decode(chunk)).toBe("cde");
  });

  it("round-trips appended lines", async () => {
    const fs = new MemoryFileSystem({});
    await fs.appendLine("/log.jsonl", "first");
    await fs.appendLine("/log.jsonl", "second");
    expect(await fs.readLines("/log.jsonl")).toEqual(["first", "second"]);
  });

  it("returns no lines for a file that does not exist", async () => {
    const fs = new MemoryFileSystem({});
    expect(await fs.readLines("/missing.jsonl")).toEqual([]);
  });

  it("reports a distinct device id per configured volume", async () => {
    const fs = new MemoryFileSystem(
      { "/vol1/a.stl": { content: "x" }, "/vol2/b.stl": { content: "y" } },
      { volumes: { "/vol1": 1, "/vol2": 2 } },
    );
    expect((await fs.stat("/vol1/a.stl")).deviceId).toBe(1);
    expect((await fs.stat("/vol2/b.stl")).deviceId).toBe(2);
  });

  it("reports the configured free space", async () => {
    const fs = new MemoryFileSystem({}, { freeSpace: 512 });
    expect(await fs.freeSpace("/anywhere")).toBe(512);
  });

  it("gives seeded files deterministic distinct timestamps", async () => {
    const fs = new MemoryFileSystem({
      "/a.stl": { content: "x" },
      "/b.stl": { content: "y" },
    });
    const first = await fs.stat("/a.stl");
    const second = await fs.stat("/b.stl");
    expect(second.birthtimeMs).toBeGreaterThan(first.birthtimeMs);
  });
});
