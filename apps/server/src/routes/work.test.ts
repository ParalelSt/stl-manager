import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);
const AUTH = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

describe("work routes", () => {
  let base: string;
  let root: string;
  let source: string;
  let library: string;
  let outside: string;
  let app: ReturnType<typeof createApp>;

  function post(url: string, body: unknown): Promise<Response> {
    return app.request(url, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
  }

  function get(url: string): Promise<Response> {
    return app.request(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }

  /** Polls a job until it stops running, so tests do not guess at timing. */
  async function settleJob(jobId: string): Promise<{ state: string; result?: unknown; error?: string }> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const body = await (await get(`/api/jobs/${jobId}`)).json();
      if (body.value.state !== "running") {
        return body.value;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("The job never finished.");
  }

  beforeEach(async () => {
    // Deliberately not the system temp directory: on macOS that resolves to
    // /private/var, which the scanner excludes as system state, so a fixture
    // placed there would be invisible to a scan.
    base = await realpath(await mkdtemp("/tmp/stl-work-"));
    root = join(base, "data");
    source = join(root, "downloads");
    library = join(root, "library");
    outside = join(base, "secret");
    await mkdir(source, { recursive: true });
    await mkdir(library, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(source, "kit_base.stl"), "base-mesh");
    await writeFile(join(source, "kit_lip.stl"), "lip-mesh");

    const config: ServerConfig = { port: 8080, roots: [root], configDir: "/config", dropDir: "/config/drops", trustProxy: false };
    app = createApp({ config, token: TOKEN, shareToken: SHARE_TOKEN, fs: new NodeFileSystem(), path: posixPath });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  describe("POST /api/scans", () => {
    it("returns a job identifier immediately", async () => {
      const response = await post("/api/scans", { roots: [source], libraryRoot: library });
      expect(response.status).toBe(202);
      expect((await response.json()).value.jobId).toBeTypeOf("string");
    });

    it("eventually produces a plan on the job", async () => {
      const { value } = await (await post("/api/scans", { roots: [source], libraryRoot: library })).json();
      const job = await settleJob(value.jobId);
      expect(job.state).toBe("succeeded");
      const plan = job.result as { groups: unknown[]; moves: unknown[] };
      expect(plan.groups).toHaveLength(1);
      expect(plan.moves).toHaveLength(2);
    });

    it("refuses a scan root outside the mounted roots", async () => {
      expect((await post("/api/scans", { roots: [outside], libraryRoot: library })).status).toBe(400);
    });

    it("refuses a library root outside the mounted roots", async () => {
      expect((await post("/api/scans", { roots: [source], libraryRoot: outside })).status).toBe(400);
    });

    it("refuses a body with no roots", async () => {
      expect((await post("/api/scans", { roots: [], libraryRoot: library })).status).toBe(400);
    });

    it("refuses a body that is not an object", async () => {
      expect((await post("/api/scans", "nonsense")).status).toBe(400);
    });

    it("requires a token", async () => {
      const response = await app.request("/api/scans", { method: "POST", body: "{}" });
      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/applies", () => {
    function move(from: string, to: string, size: number) {
      return { from, to, groupId: "kit", reason: "model" as const, size };
    }

    it("moves the files it is given", async () => {
      const moves = [move(join(source, "kit_base.stl"), join(library, "kit", "kit_base.stl"), 9)];
      const { value } = await (await post("/api/applies", { libraryRoot: library, moves })).json();
      const job = await settleJob(value.jobId);
      expect(job.state).toBe("succeeded");
      expect((job.result as { moved: number }).moved).toBe(1);
    });

    it("refuses a move whose source is outside the roots", async () => {
      await writeFile(join(outside, "evil.stl"), "x");
      const moves = [move(join(outside, "evil.stl"), join(library, "kit", "evil.stl"), 1)];
      expect((await post("/api/applies", { libraryRoot: library, moves })).status).toBe(400);
    });

    it("refuses a move whose destination escapes the library", async () => {
      const moves = [
        move(join(source, "kit_base.stl"), join(library, "..", "..", "escaped.stl"), 9),
      ];
      expect((await post("/api/applies", { libraryRoot: library, moves })).status).toBe(400);
    });

    it("refuses a destination pointing at an absolute path elsewhere", async () => {
      const moves = [move(join(source, "kit_base.stl"), "/etc/evil.stl", 9)];
      expect((await post("/api/applies", { libraryRoot: library, moves })).status).toBe(400);
    });

    it("writes nothing when any move in the request is refused", async () => {
      const moves = [
        move(join(source, "kit_base.stl"), join(library, "kit", "kit_base.stl"), 9),
        move(join(source, "kit_lip.stl"), "/etc/evil.stl", 8),
      ];
      expect((await post("/api/applies", { libraryRoot: library, moves })).status).toBe(400);
      // The first move must not have been applied on the way to rejecting the second.
      const listing = await new NodeFileSystem().list(library);
      expect(listing).toEqual([]);
    });

    it("accepts an apply with no moves", async () => {
      const response = await post("/api/applies", { libraryRoot: library, moves: [] });
      expect(response.status).toBe(202);
    });
  });

  describe("GET /api/runs", () => {
    it("lists past runs from the library journal", async () => {
      const moves = [
        { from: join(source, "kit_base.stl"), to: join(library, "kit", "kit_base.stl"), groupId: "kit", reason: "model" as const, size: 9 },
      ];
      const { value } = await (await post("/api/applies", { libraryRoot: library, moves })).json();
      await settleJob(value.jobId);

      const body = await (await get(`/api/runs?libraryRoot=${encodeURIComponent(library)}`)).json();
      expect(body.value).toHaveLength(1);
      expect(body.value[0].moved).toBe(1);
    });

    it("refuses a library outside the roots", async () => {
      const response = await get(`/api/runs?libraryRoot=${encodeURIComponent(outside)}`);
      expect(response.status).toBe(400);
    });

    it("refuses a missing libraryRoot", async () => {
      expect((await get("/api/runs")).status).toBe(400);
    });
  });

  describe("GET /api/jobs/:id", () => {
    it("returns 404 for an unknown job", async () => {
      expect((await get("/api/jobs/nope")).status).toBe(404);
    });

    it("returns 404 events for an unknown job", async () => {
      expect((await get("/api/jobs/nope/events")).status).toBe(404);
    });

    it("streams progress and closes when the job finishes", async () => {
      const { value } = await (await post("/api/scans", { roots: [source], libraryRoot: library })).json();
      const response = await get(`/api/jobs/${value.jobId}/events`);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const text = await response.text();
      expect(text).toContain("event: done");
    });
  });
  describe("GET /api/library", () => {
  it("reads the library from disk", async () => {
    const moves = [
      { from: join(source, "kit_base.stl"), to: join(library, "kit", "kit_base.stl"), groupId: "kit", reason: "model" as const, size: 9 },
    ];
    const started = await (await post("/api/applies", { libraryRoot: library, moves })).json();
    await settleJob(started.value.jobId);

    const body = await (await get(`/api/library?libraryRoot=${encodeURIComponent(library)}`)).json();
    expect(body.value.fileCount).toBe(1);
    expect(body.value.children[0].name).toBe("kit");
  });

  it("refuses a library outside the roots", async () => {
    expect((await get(`/api/library?libraryRoot=${encodeURIComponent(outside)}`)).status).toBe(400);
  });

  it("refuses a missing libraryRoot", async () => {
    expect((await get("/api/library")).status).toBe(400);
  });
});
});
