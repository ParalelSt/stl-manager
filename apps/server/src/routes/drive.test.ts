import { mkdir, mkdtemp, readdir, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";
import { safeDriveName } from "./drive.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);

describe("Google Drive", () => {
  let base: string;
  let root: string;
  let staging: string;
  let configDir: string;
  let app: ReturnType<typeof createApp>;
  let queued: (() => Response)[];

  function asOwner(path: string, init?: RequestInit): Promise<Response> {
    return app.request(path, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    });
  }

  async function connect(): Promise<void> {
    await asOwner("/api/drive", {
      method: "PUT",
      body: JSON.stringify({
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
      }),
    });
  }

  async function settle(jobId: string): Promise<{ state: string; result?: unknown }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const body = await (await asOwner(`/api/jobs/${jobId}`)).json();
      if (body.value.state !== "running") {
        return body.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The job never finished.");
  }

  beforeEach(async () => {
    base = await realpath(await mkdtemp("/tmp/stl-drive-"));
    root = join(base, "data");
    staging = join(root, "_Incoming");
    configDir = join(base, "config");
    await mkdir(staging, { recursive: true });
    await mkdir(configDir, { recursive: true });
    queued = [];

    const config: ServerConfig = {
      port: 8080,
      roots: [root],
      configDir,
      dropDir: join(base, "drops"),
    };
    app = createApp({
      config,
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new NodeFileSystem(),
      path: posixPath,
      fetch: () => {
        const next = queued.shift();
        if (next === undefined) {
          return Promise.reject(new Error("No Drive response queued."));
        }
        return Promise.resolve(next());
      },
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("reports no Drive before one is connected", async () => {
    const body = await (await asOwner("/api/drive")).json();
    expect(body.value.isConnected).toBe(false);
  });

  it("stores a credential and reports it connected", async () => {
    await connect();
    expect((await (await asOwner("/api/drive")).json()).value.isConnected).toBe(true);
  });

  it("never returns the credential it stored", async () => {
    await connect();
    const text = await (await asOwner("/api/drive")).text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("refresh");
  });

  it("refuses an incomplete credential", async () => {
    const response = await asOwner("/api/drive", {
      method: "PUT",
      body: JSON.stringify({ clientId: "only-this" }),
    });
    expect(response.status).toBe(400);
  });

  it("forgets a credential", async () => {
    await connect();
    await asOwner("/api/drive", { method: "DELETE" });
    expect((await (await asOwner("/api/drive")).json()).value.isConnected).toBe(false);
  });

  it("refuses to browse before a Drive is connected", async () => {
    expect((await asOwner("/api/drive/catalogue")).status).toBe(400);
  });

  it("lists a folder once connected", async () => {
    await connect();
    queued = [
      () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }),
      () =>
        new Response(
          JSON.stringify({
            files: [
              { id: "1", name: "kit_base.stl", mimeType: "application/octet-stream", size: "9" },
            ],
          }),
          { status: 200 },
        ),
    ];
    const body = await (await asOwner("/api/drive/catalogue?folderId=abc")).json();
    expect(body.value.children[0].name).toBe("kit_base.stl");
  });

  it("pulls files into staging", async () => {
    await connect();
    queued = [
      () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }),
      () => new Response("mesh-bytes", { status: 200 }),
    ];
    const started = await (
      await asOwner("/api/drive/pulls", {
        method: "POST",
        body: JSON.stringify({
          stagingDir: staging,
          files: [{ id: "1", name: "kit_base.stl" }],
        }),
      })
    ).json();

    const job = await settle(started.value.jobId);
    expect((job.result as { fetched: number }).fetched).toBe(1);
    expect(await readdir(staging)).toEqual(["kit_base.stl"]);
    expect(await readFile(join(staging, "kit_base.stl"), "utf8")).toBe("mesh-bytes");
  });

  it("never writes outside staging, whatever Drive calls a file", async () => {
    await connect();
    queued = [() => new Response(JSON.stringify({ access_token: "x" }), { status: 200 })];
    const started = await (
      await asOwner("/api/drive/pulls", {
        method: "POST",
        body: JSON.stringify({
          stagingDir: staging,
          files: [
            { id: "1", name: "../../escape.stl" },
            { id: "2", name: ".." },
          ],
        }),
      })
    ).json();

    const job = await settle(started.value.jobId);
    const result = job.result as { fetched: number; failed: unknown[] };
    // The first is reduced to a bare name, the second is refused outright.
    expect(result.failed.length + result.fetched).toBe(2);
    for (const name of await readdir(staging)) {
      expect(name).not.toContain("..");
    }
    expect(await readdir(root)).toEqual(["_Incoming"]);
  });

  it("refuses a staging folder outside the roots", async () => {
    await connect();
    const response = await asOwner("/api/drive/pulls", {
      method: "POST",
      body: JSON.stringify({ stagingDir: "/etc", files: [] }),
    });
    expect(response.status).toBe(400);
  });

  it("requires the machine's own token", async () => {
    expect((await app.request("/api/drive")).status).toBe(401);
    const asShare = await app.request("/api/drive", {
      headers: { Authorization: `Bearer ${SHARE_TOKEN}` },
    });
    expect(asShare.status).toBe(401);
  });
});

describe("safeDriveName", () => {
  it("keeps an ordinary name", () => {
    expect(safeDriveName("kit_base.stl")).toBe("kit_base.stl");
  });

  it("takes only the last segment", () => {
    expect(safeDriveName("../../etc/passwd.stl")).toBe("passwd.stl");
  });

  it("refuses the directory shorthands", () => {
    expect(safeDriveName("..")).toBeUndefined();
    expect(safeDriveName(".")).toBeUndefined();
  });

  it("strips leading dots so nothing becomes hidden", () => {
    expect(safeDriveName(".hidden.stl")).toBe("hidden.stl");
  });

  it("refuses a name with a null byte", () => {
    expect(safeDriveName("a\0b.stl")).toBeUndefined();
  });
});
