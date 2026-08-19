import { posixPath } from "@stl-manager/core";
import { MemoryFileSystem } from "@stl-manager/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";
import { createAuthLimiter } from "./rateLimit.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);
const WRONG = "z".repeat(64);

const CONFIG: ServerConfig = {
  port: 8080,
  roots: ["/data"],
  configDir: "/config",
  dropDir: "/config/drops",
  trustProxy: false,
};

/**
 * Guessing a token has to be slow.
 *
 * The token itself is not guessable, but phase 4 puts this server on the
 * internet, and an endpoint that answers attempts as fast as they arrive is
 * still worth closing.
 */
describe("failed authentication is limited", () => {
  let app: ReturnType<typeof createApp>;
  let clock: number;

  function attempt(token: string): Promise<Response> {
    return app.request("/api/roots", { headers: { Authorization: `Bearer ${token}` } });
  }

  beforeEach(() => {
    clock = 1_700_000_000_000;
    app = createApp({
      config: CONFIG,
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new MemoryFileSystem({}),
      path: posixPath,
      limiter: createAuthLimiter({ maxFailures: 3, windowMs: 1000, now: () => clock }),
    });
  });

  it("refuses the first few wrong tokens normally", async () => {
    expect((await attempt(WRONG)).status).toBe(401);
    expect((await attempt(WRONG)).status).toBe(401);
  });

  it("stops answering after too many wrong tokens", async () => {
    for (let tries = 0; tries < 3; tries += 1) {
      await attempt(WRONG);
    }
    const response = await attempt(WRONG);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
  });

  it("refuses the correct token too while blocked", async () => {
    for (let tries = 0; tries < 3; tries += 1) {
      await attempt(WRONG);
    }
    // Otherwise an attacker learns which guess was right from the status.
    expect((await attempt(TOKEN)).status).toBe(429);
  });

  it("answers again once the window has passed", async () => {
    for (let tries = 0; tries < 3; tries += 1) {
      await attempt(WRONG);
    }
    clock += 1001;
    expect((await attempt(TOKEN)).status).toBe(200);
  });

  it("forgets the failures once a correct token is given", async () => {
    await attempt(WRONG);
    await attempt(WRONG);
    expect((await attempt(TOKEN)).status).toBe(200);
    await attempt(WRONG);
    await attempt(WRONG);
    // Two more failures would have hit the limit had the success not cleared it.
    expect((await attempt(TOKEN)).status).toBe(200);
  });

  it("limits the share routes as well", async () => {
    for (let tries = 0; tries < 3; tries += 1) {
      await app.request("/api/share/catalogue?libraryRoot=/data", {
        headers: { Authorization: `Bearer ${WRONG}` },
      });
    }
    const response = await app.request("/api/share/catalogue?libraryRoot=/data", {
      headers: { Authorization: `Bearer ${SHARE_TOKEN}` },
    });
    expect(response.status).toBe(429);
  });

  it("cannot be evaded with a forwarded header when no proxy is declared", async () => {
    for (let tries = 0; tries < 3; tries += 1) {
      await attempt(WRONG);
    }
    // Claiming a fresh address must not reset the count, or the limit is
    // worth nothing.
    const response = await app.request("/api/roots", {
      headers: { Authorization: `Bearer ${WRONG}`, "X-Forwarded-For": "9.9.9.9" },
    });
    expect(response.status).toBe(429);
  });

  it("believes a forwarded header only when a proxy is declared", async () => {
    const behindProxy = createApp({
      config: { ...CONFIG, trustProxy: true },
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new MemoryFileSystem({}),
      path: posixPath,
      limiter: createAuthLimiter({ maxFailures: 3, windowMs: 1000, now: () => clock }),
    });

    for (let tries = 0; tries < 3; tries += 1) {
      await behindProxy.request("/api/roots", {
        headers: { Authorization: `Bearer ${WRONG}`, "X-Forwarded-For": "1.1.1.1" },
      });
    }
    // A different visitor behind the same proxy is unaffected.
    const other = await behindProxy.request("/api/roots", {
      headers: { Authorization: `Bearer ${TOKEN}`, "X-Forwarded-For": "2.2.2.2" },
    });
    expect(other.status).toBe(200);

    const same = await behindProxy.request("/api/roots", {
      headers: { Authorization: `Bearer ${TOKEN}`, "X-Forwarded-For": "1.1.1.1" },
    });
    expect(same.status).toBe(429);
  });

  it("does not limit the public share links", async () => {
    // Those carry their secret in the URL and are meant for strangers; a
    // limiter there would let one person deny everyone else a shared file.
    for (let tries = 0; tries < 6; tries += 1) {
      expect((await app.request("/s/nonsense")).status).toBe(404);
    }
  });
});
