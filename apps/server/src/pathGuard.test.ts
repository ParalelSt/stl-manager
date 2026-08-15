import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPathGuard, type PathGuard } from "./pathGuard.js";

/**
 * These run against real directories on purpose.
 *
 * What is being tested is what the operating system does with "..", with
 * symbolic links, and with paths that only look like they are inside a root.
 * None of that can be simulated in memory, and getting it wrong is the one
 * mistake in this phase that would let a request reach the whole container.
 */
describe("PathGuard", () => {
  let base: string;
  let root: string;
  let outside: string;
  let guard: PathGuard;

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "stl-guard-")));
    root = join(base, "data");
    outside = join(base, "secret");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await mkdir(join(root, "models"), { recursive: true });
    await writeFile(join(outside, "passwords.txt"), "sensitive");
    guard = createPathGuard([root]);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("accepts a root itself", async () => {
    await expect(guard.resolve(root)).resolves.toBe(root);
  });

  it("accepts a directory inside a root", async () => {
    await expect(guard.resolve(join(root, "models"))).resolves.toBe(join(root, "models"));
  });

  it("normalises a path containing a harmless ..", async () => {
    await expect(guard.resolve(join(root, "models", "..", "models"))).resolves.toBe(
      join(root, "models"),
    );
  });

  it("refuses a path outside every root", async () => {
    await expect(guard.resolve(outside)).rejects.toThrow();
  });

  it("refuses traversal with ..", async () => {
    await expect(guard.resolve(join(root, "..", "secret"))).rejects.toThrow();
  });

  it("refuses traversal buried in the middle of a path", async () => {
    await expect(
      guard.resolve(join(root, "models", "..", "..", "secret", "passwords.txt")),
    ).rejects.toThrow();
  });

  it("refuses a symlink pointing outside the roots", async () => {
    await symlink(outside, join(root, "escape"));
    await expect(guard.resolve(join(root, "escape"))).rejects.toThrow();
  });

  it("refuses a path reached through a symlinked parent", async () => {
    await symlink(outside, join(root, "escape"));
    await expect(guard.resolve(join(root, "escape", "passwords.txt"))).rejects.toThrow();
  });

  it("accepts a symlink pointing inside the roots", async () => {
    await symlink(join(root, "models"), join(root, "link"));
    await expect(guard.resolve(join(root, "link"))).resolves.toBe(join(root, "models"));
  });

  it("refuses a sibling whose name merely starts with a root's name", async () => {
    const lookalike = `${root}-backup`;
    await mkdir(lookalike, { recursive: true });
    await expect(guard.resolve(lookalike)).rejects.toThrow();
  });

  it("refuses a path that does not exist", async () => {
    await expect(guard.resolve(join(root, "nowhere"))).rejects.toThrow();
  });

  it("refuses a relative path", async () => {
    await expect(guard.resolve("models")).rejects.toThrow();
  });

  it("refuses an empty path", async () => {
    await expect(guard.resolve("")).rejects.toThrow();
  });

  it("refuses a path containing a null byte", async () => {
    await expect(guard.resolve(`${root}\0/etc`)).rejects.toThrow();
  });

  it("accepts a path in any one of several roots", async () => {
    const second = join(base, "more");
    await mkdir(second, { recursive: true });
    const wider = createPathGuard([root, second]);
    await expect(wider.resolve(second)).resolves.toBe(second);
    await expect(wider.resolve(root)).resolves.toBe(root);
  });

  it("still refuses everything else when several roots are configured", async () => {
    const second = join(base, "more");
    await mkdir(second, { recursive: true });
    const wider = createPathGuard([root, second]);
    await expect(wider.resolve(outside)).rejects.toThrow();
  });

  it("reports the roots for the interface to offer", () => {
    expect(guard.roots()).toEqual([{ path: root, label: "data" }]);
  });

  it("says what was wrong without echoing the path back", async () => {
    // Echoing an attacker-supplied path into an error is how a refusal becomes
    // a reflection vector in whatever renders it.
    await expect(guard.resolve(outside)).rejects.toThrow(/outside/i);
    await expect(guard.resolve(outside)).rejects.not.toThrow(new RegExp(outside));
  });
});
