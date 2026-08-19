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
      "/lib/_Duplicates/M/tower.stl",
    );
    expect(destinationFor(result, "/home/M/tower (2).stl")).toBe("/lib/tower/tower.stl");
  });

  it("keeps both files when a divergent one shares the name, distinguishing them", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "short" },
      "/home/M/tower (2).stl": { content: "much longer content" },
    });
    const destinations = [
      destinationFor(result, "/home/M/tower.stl"),
      destinationFor(result, "/home/M/tower (2).stl"),
    ].sort();
    expect(destinations).toEqual(["/lib/tower/tower (2).stl", "/lib/tower/tower.stl"]);
  });

  it("strips the duplicate marker from the winner's filename", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "same" },
      "/home/M/tower (2).stl": { content: "same" },
    });
    expect(destinationFor(result, "/home/M/tower (2).stl")).toBe("/lib/tower/tower.stl");
  });

  it("strips a copy marker from the winner's filename", async () => {
    const result = await buildPlan({
      "/home/A/space_marine.stl": { content: "same" },
      "/home/B/space_marine copy.stl": { content: "same" },
    });
    const kept = result.moves.find((move) => move.reason === "model");
    expect(kept?.to).toBe("/lib/space_marine/space_marine.stl");
  });

  it("keeps the original filename on a quarantined copy", async () => {
    const result = await buildPlan({
      "/home/M/tower.stl": { content: "same" },
      "/home/M/tower (2).stl": { content: "same" },
    });
    expect(destinationFor(result, "/home/M/tower.stl")).toBe(
      "/lib/_Duplicates/M/tower.stl",
    );
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

describe("naming files inside a family", () => {
  it("keeps each model's own name rather than the family name", async () => {
    const result = await buildPlan({
      "/home/Set/kit_base.stl": { content: "base" },
      "/home/Set/kit_lip.stl": { content: "lip" },
    });
    expect(result.moves.map((move) => move.to).sort()).toEqual([
      "/lib/kit/kit_base.stl",
      "/lib/kit/kit_lip.stl",
    ]);
  });

  it("does not compare different models in a family as duplicates", async () => {
    const result = await buildPlan({
      "/home/Set/kit_base.stl": { content: "same" },
      "/home/Set/kit_lip.stl": { content: "same" },
    });
    expect(result.moves.filter((move) => move.reason === "duplicate")).toEqual([]);
    expect(result.moves).toHaveLength(2);
  });

  it("still quarantines a real duplicate of one model in a family", async () => {
    const result = await buildPlan({
      "/home/Set/kit_base.stl": { content: "base" },
      "/home/Set/kit_base (1).stl": { content: "base" },
      "/home/Set/kit_lip.stl": { content: "lip" },
    });
    expect(result.moves.filter((move) => move.reason === "duplicate")).toHaveLength(1);
  });
});

describe("giving a model its own folder", () => {
  it("nests a model that is several files, inside a family of several models", async () => {
    const result = await buildPlan({
      "/home/Set/cam_medium.stl": { content: "medium" },
      "/home/Set/cam_medium.jpg": { content: "preview" },
      "/home/Set/cam_mild.stl": { content: "mild" },
    });
    expect(result.moves.map((move) => move.to).sort()).toEqual([
      // Several files, so they travel together in a folder of their own.
      "/lib/cam/cam_medium/cam_medium.jpg",
      "/lib/cam/cam_medium/cam_medium.stl",
      // A lone file needs no folder.
      "/lib/cam/cam_mild.stl",
    ]);
  });

  it("does not nest when every model in the family is a single file", async () => {
    const result = await buildPlan({
      "/home/Set/cam_medium.stl": { content: "medium" },
      "/home/Set/cam_mild.stl": { content: "mild" },
    });
    expect(result.moves.map((move) => move.to).sort()).toEqual([
      "/lib/cam/cam_medium.stl",
      "/lib/cam/cam_mild.stl",
    ]);
  });

  it("does not repeat the name when the family holds one model", async () => {
    const result = await buildPlan({
      "/home/Set/space_marine.stl": { content: "mesh" },
      "/home/Set/space_marine.jpg": { content: "preview" },
    });
    // Not /lib/space_marine/space_marine/space_marine.stl.
    expect(result.moves.map((move) => move.to).sort()).toEqual([
      "/lib/space_marine/space_marine.jpg",
      "/lib/space_marine/space_marine.stl",
    ]);
  });

  it("keeps a slicer file with the model it belongs to", async () => {
    const result = await buildPlan({
      "/home/Set/cam_medium.stl": { content: "medium" },
      "/home/Set/cam_medium.ctb": { content: "sliced" },
      "/home/Set/cam_mild.stl": { content: "mild" },
    });
    expect(result.moves.map((move) => move.to)).toContain("/lib/cam/cam_medium/cam_medium.ctb");
  });

  it("still quarantines duplicates rather than nesting them", async () => {
    const result = await buildPlan({
      "/home/Set/cam_medium.stl": { content: "same" },
      "/home/Set/cam_medium (1).stl": { content: "same" },
      "/home/Set/cam_mild.stl": { content: "mild" },
    });
    const quarantined = result.moves.filter((move) => move.reason === "duplicate");
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.to).toContain("_Duplicates");
  });
});
