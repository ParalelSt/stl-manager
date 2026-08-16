import { posixPath } from "@stl-manager/core";
import { MemoryFileSystem } from "@stl-manager/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ServerConfig } from "./config.js";

const TOKEN = "a".repeat(64);
const CONFIG: ServerConfig = { port: 8080, roots: ["/data/models"], configDir: "/config", dropDir: "/config/drops" };

describe("authentication", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp({
      config: CONFIG,
      token: TOKEN,
      fs: new MemoryFileSystem({}),
      path: posixPath,
    });
  });

  it("allows /health with no token", async () => {
    expect((await app.request("/health")).status).toBe(200);
  });

  it("refuses an api route with no token", async () => {
    expect((await app.request("/api/roots")).status).toBe(401);
  });

  it("refuses an api route with a wrong token", async () => {
    const response = await app.request("/api/roots", {
      headers: { Authorization: `Bearer ${"b".repeat(64)}` },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a token of the wrong length", async () => {
    const response = await app.request("/api/roots", { headers: { Authorization: "Bearer short" } });
    expect(response.status).toBe(401);
  });

  it("refuses an authorization header with no scheme", async () => {
    const response = await app.request("/api/roots", { headers: { Authorization: TOKEN } });
    expect(response.status).toBe(401);
  });

  it("refuses a different scheme", async () => {
    const response = await app.request("/api/roots", {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(response.status).toBe(401);
  });

  it("allows an api route with the correct token", async () => {
    const response = await app.request("/api/roots", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it("never names the expected token in a refusal", async () => {
    const response = await app.request("/api/roots", { headers: { Authorization: "Bearer wrong" } });
    expect(await response.text()).not.toContain(TOKEN);
  });

  it("lists the configured roots with labels", async () => {
    const response = await app.request("/api/roots", {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(await response.json()).toEqual({
      ok: true,
      value: [{ path: "/data/models", label: "models" }],
    });
  });
});
