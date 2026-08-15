import { describe, expect, it } from "vitest";
import { posixPath } from "@stl-manager/core";
import { MemoryFileSystem } from "@stl-manager/core/testing";
import { ensureToken, isTokenValid, TOKEN_FILENAME } from "./token.js";

const TOKEN_PATH = `/config/${TOKEN_FILENAME}`;

describe("ensureToken", () => {
  it("generates and stores a token on first start", async () => {
    const fs = new MemoryFileSystem({});
    const token = await ensureToken(fs, posixPath, "/config");
    expect(token).toHaveLength(64);
    expect(await fs.readLines(TOKEN_PATH)).toEqual([token]);
  });

  it("returns the stored token on later starts", async () => {
    const fs = new MemoryFileSystem({});
    const first = await ensureToken(fs, posixPath, "/config");
    const second = await ensureToken(fs, posixPath, "/config");
    expect(second).toBe(first);
  });

  it("regenerates when the stored token is empty", async () => {
    const fs = new MemoryFileSystem({ [TOKEN_PATH]: { content: "\n" } });
    const token = await ensureToken(fs, posixPath, "/config");
    expect(token).toHaveLength(64);
  });

  it("ignores surrounding whitespace in a stored token", async () => {
    const fs = new MemoryFileSystem({ [TOKEN_PATH]: { content: "  abc123  \n" } });
    expect(await ensureToken(fs, posixPath, "/config")).toBe("abc123");
  });

  it("generates a different token each time", async () => {
    const first = await ensureToken(new MemoryFileSystem({}), posixPath, "/config");
    const second = await ensureToken(new MemoryFileSystem({}), posixPath, "/config");
    expect(first).not.toBe(second);
  });
});

describe("isTokenValid", () => {
  it("accepts the correct token", () => {
    expect(isTokenValid("abc123", "abc123")).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(isTokenValid("abc123", "abc124")).toBe(false);
  });

  it("rejects a wrong token of a different length", () => {
    expect(isTokenValid("abc", "abc123")).toBe(false);
  });

  it("rejects an empty supplied token", () => {
    expect(isTokenValid("", "abc123")).toBe(false);
  });

  it("rejects everything when the expected token is empty", () => {
    expect(isTokenValid("", "")).toBe(false);
    expect(isTokenValid("anything", "")).toBe(false);
  });
});
