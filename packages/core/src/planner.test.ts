import { describe, expect, it } from "vitest";
import { MemoryFileSystem, type MemorySeedEntry } from "./memoryFileSystem.js";
import { plan, type SortPlan } from "./planner.js";
import { posixPath } from "./posixPath.js";

const LIBRARY = "/lib";

function buildPlan(seed: Record<string, MemorySeedEntry>): Promise<SortPlan> {
  return plan({
    fs: new MemoryFileSystem(seed),
    path: posixPath,
    roots: ["/home"],
    libraryRoot: LIBRARY,
  });
}

function destinationFor(sortPlan: SortPlan, from: string): string | undefined {
  return sortPlan.moves.find((move) => move.from === from)?.to;
}

describe("plan", () => {
  it("places a purposed group under its purpose folder", async () => {
    const result = await buildPlan({
      "/home/Terrain/tower.stl": { content: "a" },
      "/home/Terrain/wall.stl": { content: "b" },
    });
    expect(destinationFor(result, "/home/Terrain/tower.stl")).toBe(
      "/lib/Terrain/tower/tower.stl",
    );
  });

  it("places an unpurposed group directly under the library", async () => {
    const result = await buildPlan({ "/home/Odd/tower.stl": { content: "a" } });
    expect(destinationFor(result, "/home/Odd/tower.stl")).toBe("/lib/tower/tower.stl");
  });

  it("sends an identical duplicate to the quarantine folder mirroring its path", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "same" },
      "/home/M/tower (2).stl": { content: "same" },
    });
    expect(destinationFor(result, "/home/M/tower.stl")).toBe(
      "/lib/_Duplicates/home/M/tower.stl",
    );
    expect(destinationFor(result, "/home/M/tower (2).stl")).toBe("/lib/tower/tower (2).stl");
  });

  it("keeps a divergent same-named file in the group folder with its suffix intact", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "short" },
      "/home/M/tower (2).stl": { content: "much longer content" },
    });
    expect(destinationFor(result, "/home/M/tower.stl")).toBe("/lib/tower/tower.stl");
    expect(destinationFor(result, "/home/M/tower (2).stl")).toBe("/lib/tower/tower (2).stl");
  });

  it("moves a companion into its model's folder", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "a" },
      "/home/M/tower.jpg": { content: "b" },
    });
    expect(destinationFor(result, "/home/M/tower.jpg")).toBe("/lib/tower/tower.jpg");
  });

  it("does not plan a move for a companion with no model to follow", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "a" },
      "/home/Photos/holiday.jpg": { content: "b" },
    });
    expect(destinationFor(result, "/home/Photos/holiday.jpg")).toBeUndefined();
  });

  it("never plans two moves to the same destination", async () => {
    const result = await buildPlan({
      "/home/A/tower.stl": { content: "one" },
      "/home/B/tower.stl": { content: "two" },
    });
    const destinations = result.moves.map((move) => move.to);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  it("treats destinations differing only in case as colliding", async () => {
    const result = await buildPlan({
      "/home/A/Tower.stl": { content: "one" },
      "/home/B/tower.stl": { content: "two" },
    });
    const lowered = result.moves.map((move) => move.to.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("labels every move with the reason it was planned", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "same" },
      "/home/M/tower (2).stl": { content: "same" },
      "/home/M/tower.jpg": { content: "image" },
    });
    const reasons = new Map(result.moves.map((move) => [move.from, move.reason]));
    expect(reasons.get("/home/M/tower (2).stl")).toBe("model");
    expect(reasons.get("/home/M/tower.stl")).toBe("duplicate");
    expect(reasons.get("/home/M/tower.jpg")).toBe("companion");
  });

  it("separates duplicates per extension rather than across them", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "mesh data" },
      "/home/M/tower.obj": { content: "mesh data" },
    });
    expect(destinationFor(result, "/home/M/tower.stl")).toBe("/lib/tower/tower.stl");
    expect(destinationFor(result, "/home/M/tower.obj")).toBe("/lib/tower/tower.obj");
  });

  it("carries the groups through so the interface can present them", async () => {
    const result = await buildPlan({
      "/home/Terrain/tower.stl": { content: "a" },
      "/home/Terrain/wall.stl": { content: "b" },
    });
    expect(result.groups.map((entry) => entry.displayName)).toEqual(["tower", "wall"]);
  });

  it("writes nothing to disk", async () => {
    const fs = new MemoryFileSystem({
      "/home/M/tower.stl": { content: "a" },
      "/home/M/tower (2).stl": { content: "a" },
      "/home/M/tower.jpg": { content: "b" },
    });
    const before = fs.snapshot();
    await plan({ fs, path: posixPath, roots: ["/home"], libraryRoot: LIBRARY });
    expect(fs.snapshot()).toEqual(before);
  });
});
