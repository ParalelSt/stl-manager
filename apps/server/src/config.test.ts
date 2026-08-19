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

describe("who can reach the server", () => {
  it("answers only this machine by default", () => {
    expect(loadConfig({ STL_ROOTS: "/data" }).host).toBe("127.0.0.1");
  });

  it("answers the network when asked to", () => {
    expect(loadConfig({ STL_ROOTS: "/data", STL_ACCESS: "lan" }).host).toBe("0.0.0.0");
  });

  it("answers the network for remote access too", () => {
    const config = loadConfig({
      STL_ROOTS: "/data",
      STL_ACCESS: "remote",
      STL_TRUST_PROXY: "true",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.isRemote).toBe(true);
  });

  it("refuses remote access without a proxy in front", () => {
    // Otherwise every request looks like it comes from the tunnel, and the
    // limit on failed tokens protects nobody.
    expect(() => loadConfig({ STL_ROOTS: "/data", STL_ACCESS: "remote" })).toThrow(
      /STL_TRUST_PROXY/,
    );
  });

  it("refuses an access setting it does not recognise", () => {
    expect(() => loadConfig({ STL_ROOTS: "/data", STL_ACCESS: "everyone" })).toThrow(
      /STL_ACCESS/,
    );
  });

  it("lets an explicit host override the setting", () => {
    const config = loadConfig({ STL_ROOTS: "/data", STL_HOST: "192.168.1.5" });
    expect(config.host).toBe("192.168.1.5");
  });

  it("is not remote unless asked", () => {
    expect(loadConfig({ STL_ROOTS: "/data" }).isRemote).toBe(false);
    expect(loadConfig({ STL_ROOTS: "/data", STL_ACCESS: "lan" }).isRemote).toBe(false);
  });
});
