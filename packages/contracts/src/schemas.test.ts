import { describe, expect, it } from "vitest";
import {
  applyPlanRequestSchema,
  buildPlanRequestSchema,
  listDirectoriesRequestSchema,
  parseRequest,
  undoRunRequestSchema,
} from "./schemas.js";

describe("parseRequest", () => {
  it("accepts a well formed plan request", () => {
    const result = parseRequest(buildPlanRequestSchema, {
      roots: ["/home/me"],
      libraryRoot: "/home/me/Library",
    });
    expect(result).toEqual({
      ok: true,
      value: { roots: ["/home/me"], libraryRoot: "/home/me/Library" },
    });
  });

  it("rejects a plan request with no roots", () => {
    const result = parseRequest(buildPlanRequestSchema, { roots: [], libraryRoot: "/lib" });
    expect(result.ok).toBe(false);
  });

  it("rejects a plan request with an empty library root", () => {
    const result = parseRequest(buildPlanRequestSchema, { roots: ["/home"], libraryRoot: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects a request that is not an object at all", () => {
    expect(parseRequest(buildPlanRequestSchema, "not a request").ok).toBe(false);
    expect(parseRequest(buildPlanRequestSchema, null).ok).toBe(false);
    expect(parseRequest(buildPlanRequestSchema, undefined).ok).toBe(false);
  });

  it("rejects roots that are not strings", () => {
    const result = parseRequest(buildPlanRequestSchema, {
      roots: [42],
      libraryRoot: "/lib",
    });
    expect(result.ok).toBe(false);
  });

  it("names the offending field when it rejects", () => {
    const result = parseRequest(buildPlanRequestSchema, { roots: ["/home"], libraryRoot: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("libraryRoot");
    }
  });

  it("accepts an apply request carrying moves", () => {
    const result = parseRequest(applyPlanRequestSchema, {
      libraryRoot: "/lib",
      moves: [{ from: "/a.stl", to: "/lib/a/a.stl", groupId: "a", reason: "model", size: 10 }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an apply request with an unknown reason", () => {
    const result = parseRequest(applyPlanRequestSchema, {
      libraryRoot: "/lib",
      moves: [{ from: "/a.stl", to: "/lib/a.stl", groupId: "a", reason: "delete", size: 10 }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an apply request with a negative size", () => {
    const result = parseRequest(applyPlanRequestSchema, {
      libraryRoot: "/lib",
      moves: [{ from: "/a.stl", to: "/lib/a.stl", groupId: "a", reason: "model", size: -1 }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts an apply request with no moves at all", () => {
    const result = parseRequest(applyPlanRequestSchema, { libraryRoot: "/lib", moves: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects an undo request with no run id", () => {
    const result = parseRequest(undoRunRequestSchema, { libraryRoot: "/lib", runId: "" });
    expect(result.ok).toBe(false);
  });

  it("strips properties the schema does not declare", () => {
    const result = parseRequest(undoRunRequestSchema, {
      libraryRoot: "/lib",
      runId: "run-1",
      somethingElse: "ignored",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ libraryRoot: "/lib", runId: "run-1" });
    }
  });
});

describe("listDirectoriesRequestSchema", () => {
  it("accepts an absolute path", () => {
    expect(parseRequest(listDirectoriesRequestSchema, { path: "/data" }).ok).toBe(true);
  });

  it("rejects an empty path", () => {
    expect(parseRequest(listDirectoriesRequestSchema, { path: "" }).ok).toBe(false);
  });

  it("rejects a missing path", () => {
    expect(parseRequest(listDirectoriesRequestSchema, {}).ok).toBe(false);
  });

  it("rejects a path that is not a string", () => {
    expect(parseRequest(listDirectoriesRequestSchema, { path: 42 }).ok).toBe(false);
  });
});
