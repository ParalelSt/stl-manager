import { makeTempDir } from "./testing.js";
import { createHash } from "node:crypto";
import { rm, symlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeFileSystem } from "./nodeFileSystem.js";

describe("NodeFileSystem", () => {
  let root: string;
  const fs = new NodeFileSystem();

  beforeEach(async () => {
    root = await makeTempDir("stl-manager-test");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("marks directories, files and symlinks correctly when listing", async () => {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "model.stl"), "mesh");
    await symlink(join(root, "sub"), join(root, "link"));

    const entries = await fs.list(root);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));

    expect(byName.get("sub")?.isDirectory).toBe(true);
    expect(byName.get("model.stl")?.isDirectory).toBe(false);
    expect(byName.get("link")?.isSymbolicLink).toBe(true);
  });

  it("rejects when listing a directory that does not exist", async () => {
    await expect(fs.list(join(root, "nowhere"))).rejects.toThrow();
  });

  it("reports a real device id and size", async () => {
    await writeFile(join(root, "model.stl"), "mesh");
    const stats = await fs.stat(join(root, "model.stl"));

    expect(stats.size).toBe(4);
    expect(stats.deviceId).toBeGreaterThan(0);
    expect(stats.mtimeMs).toBeGreaterThan(0);
  });

  it("hashes a file larger than one read chunk correctly", async () => {
    const contents = "x".repeat(3 * 1024 * 1024);
    await writeFile(join(root, "big.stl"), contents);

    const expected = createHash("sha256").update(contents).digest("hex");
    expect(await fs.hash(join(root, "big.stl"))).toBe(expected);
  });

  it("gives different contents different hashes", async () => {
    await writeFile(join(root, "a.stl"), "one");
    await writeFile(join(root, "b.stl"), "two");
    expect(await fs.hash(join(root, "a.stl"))).not.toBe(await fs.hash(join(root, "b.stl")));
  });

  it("reads a chunk from the middle of a file", async () => {
    await writeFile(join(root, "a.stl"), "abcdefgh");
    const chunk = await fs.readChunk(join(root, "a.stl"), 2, 3);
    expect(new TextDecoder().decode(chunk)).toBe("cde");
  });

  it("returns only the available bytes when reading past the end", async () => {
    await writeFile(join(root, "a.stl"), "abc");
    const chunk = await fs.readChunk(join(root, "a.stl"), 1, 100);
    expect(new TextDecoder().decode(chunk)).toBe("bc");
  });

  it("round-trips appended lines and creates missing parents", async () => {
    const path = join(root, "state", "journal.jsonl");
    await fs.appendLine(path, "first");
    await fs.appendLine(path, "second");
    expect(await fs.readLines(path)).toEqual(["first", "second"]);
  });

  it("returns no lines for a file that does not exist", async () => {
    expect(await fs.readLines(join(root, "missing.jsonl"))).toEqual([]);
  });

  it("moves a file within the same volume", async () => {
    await writeFile(join(root, "a.stl"), "mesh");
    await fs.mkdir(join(root, "dest"));
    await fs.move(join(root, "a.stl"), join(root, "dest", "a.stl"));

    expect(await fs.exists(join(root, "a.stl"))).toBe(false);
    expect(await fs.exists(join(root, "dest", "a.stl"))).toBe(true);
  });

  it("copies a file leaving the original in place", async () => {
    await writeFile(join(root, "a.stl"), "mesh");
    await fs.copy(join(root, "a.stl"), join(root, "b.stl"));

    expect(await fs.exists(join(root, "a.stl"))).toBe(true);
    expect(await fs.hash(join(root, "b.stl"))).toBe(await fs.hash(join(root, "a.stl")));
  });

  it("reports positive free space", async () => {
    expect(await fs.freeSpace(root)).toBeGreaterThan(0);
  });

  it("reports a missing file as not existing", async () => {
    expect(await fs.exists(join(root, "nope.stl"))).toBe(false);
  });
});
