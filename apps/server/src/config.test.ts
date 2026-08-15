import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("reads the port from the environment", () => {
    expect(loadConfig({ PORT: "9000", STL_ROOTS: "/data" }).port).toBe(9000);
  });

  it("defaults the port to 8080", () => {
    expect(loadConfig({ STL_ROOTS: "/data" }).port).toBe(8080);
  });

  it("splits roots on the path separator", () => {
    expect(loadConfig({ STL_ROOTS: "/data/a:/data/b" }).roots).toEqual(["/data/a", "/data/b"]);
  });

  it("ignores empty segments between separators", () => {
    expect(loadConfig({ STL_ROOTS: "/data/a::/data/b:" }).roots).toEqual(["/data/a", "/data/b"]);
  });

  it("defaults the config directory", () => {
    expect(loadConfig({ STL_ROOTS: "/data" }).configDir).toBe("/config");
  });

  it("rejects a configuration with no roots", () => {
    expect(() => loadConfig({})).toThrow(/STL_ROOTS/);
  });

  it("rejects roots that are only separators", () => {
    expect(() => loadConfig({ STL_ROOTS: "::" })).toThrow(/STL_ROOTS/);
  });

  it("rejects a relative root", () => {
    expect(() => loadConfig({ STL_ROOTS: "data" })).toThrow(/absolute/);
  });

  it("rejects a port that is not a number", () => {
    expect(() => loadConfig({ PORT: "http", STL_ROOTS: "/data" })).toThrow(/PORT/);
  });

  it("rejects a port outside the usable range", () => {
    expect(() => loadConfig({ PORT: "0", STL_ROOTS: "/data" })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: "70000", STL_ROOTS: "/data" })).toThrow(/PORT/);
  });
});
