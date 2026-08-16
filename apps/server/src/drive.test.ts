import { beforeEach, describe, expect, it } from "vitest";
import { createDriveClient, type DriveClient } from "./drive.js";

const CREDENTIALS = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
};

const API = "https://drive.test/v3";
const TOKENS = "https://tokens.test/token";

interface Recorded {
  url: string;
  authorization: string | undefined;
}

/**
 * Driven against recorded shapes of Drive responses.
 *
 * These prove what the client does with a given answer. They cannot prove
 * Google sends that answer, which is the one gap this phase cannot close
 * without a real account, and it is stated in the design and the docs rather
 * than glossed over.
 */
describe("the Drive client", () => {
  let calls: Recorded[];
  let responses: (() => Response)[];

  function clientWith(queued: (() => Response)[]): DriveClient {
    responses = queued;
    return createDriveClient({
      credentials: CREDENTIALS,
      apiBase: API,
      tokenUrl: TOKENS,
      retryDelayMs: 1,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), authorization: headers.get("Authorization") ?? undefined });
        const next = responses.shift();
        if (next === undefined) {
          throw new Error(`No response queued for ${String(input)}`);
        }
        return Promise.resolve(next());
      },
    });
  }

  function tokenResponse(token = "access-1"): () => Response {
    return () => new Response(JSON.stringify({ access_token: token }), { status: 200 });
  }

  function listResponse(files: unknown[], nextPageToken?: string): () => Response {
    return () =>
      new Response(JSON.stringify({ files, ...(nextPageToken ? { nextPageToken } : {}) }), {
        status: 200,
      });
  }

  beforeEach(() => {
    calls = [];
  });

  describe("listing a folder", () => {
    it("lists model files", async () => {
      const client = clientWith([
        tokenResponse(),
        listResponse([
          { id: "1", name: "kit_base.stl", mimeType: "application/octet-stream", size: "1200" },
          { id: "2", name: "kit_lip.obj", mimeType: "application/octet-stream", size: "900" },
        ]),
      ]);

      const tree = await client.catalogue("folder-1", "My Drive");
      expect(tree.children.map((child) => child.name)).toEqual(["kit_base.stl", "kit_lip.obj"]);
      expect(tree.fileCount).toBe(2);
      expect(tree.totalBytes).toBe(2100);
    });

    it("carries the Drive identifier rather than a path", async () => {
      const client = clientWith([
        tokenResponse(),
        listResponse([
          { id: "abc123", name: "kit_base.stl", mimeType: "application/octet-stream", size: "10" },
        ]),
      ]);
      const tree = await client.catalogue("folder-1", "My Drive");
      expect(tree.children[0]?.path).toBe("abc123");
    });

    it("ignores files this application would not collect anyway", async () => {
      const client = clientWith([
        tokenResponse(),
        listResponse([
          { id: "1", name: "kit_base.stl", mimeType: "application/octet-stream", size: "10" },
          { id: "2", name: "holiday.mp4", mimeType: "video/mp4", size: "99" },
          { id: "3", name: "taxes.xlsx", mimeType: "application/vnd.ms-excel", size: "99" },
        ]),
      ]);
      const tree = await client.catalogue("folder-1", "My Drive");
      expect(tree.children.map((child) => child.name)).toEqual(["kit_base.stl"]);
    });

    it("ignores folders", async () => {
      const client = clientWith([
        tokenResponse(),
        listResponse([
          { id: "1", name: "Terrain", mimeType: "application/vnd.google-apps.folder" },
          { id: "2", name: "kit_base.stl", mimeType: "application/octet-stream", size: "10" },
        ]),
      ]);
      expect((await client.catalogue("f", "My Drive")).children).toHaveLength(1);
    });

    it("ignores Google's own formats, which have no bytes to fetch", async () => {
      const client = clientWith([
        tokenResponse(),
        listResponse([
          { id: "1", name: "notes.stl", mimeType: "application/vnd.google-apps.document" },
        ]),
      ]);
      expect((await client.catalogue("f", "My Drive")).children).toEqual([]);
    });

    it("follows paging to the end", async () => {
      const client = clientWith([
        tokenResponse(),
        listResponse(
          [{ id: "1", name: "a.stl", mimeType: "application/octet-stream", size: "1" }],
          "page-2",
        ),
        listResponse([{ id: "2", name: "b.stl", mimeType: "application/octet-stream", size: "1" }]),
      ]);
      const tree = await client.catalogue("f", "My Drive");
      expect(tree.children).toHaveLength(2);
      expect(calls.at(-1)?.url).toContain("pageToken=page-2");
    });

    it("asks only for files that are not in the bin", async () => {
      const client = clientWith([tokenResponse(), listResponse([])]);
      await client.catalogue("folder-1", "My Drive");
      // URLSearchParams encodes spaces as "+", which decodeURIComponent leaves.
      const query = decodeURIComponent(calls[1]?.url ?? "").replace(/\+/g, " ");
      expect(query).toContain("trashed = false");
      expect(query).toContain("'folder-1' in parents");
    });
  });

  describe("credentials", () => {
    it("exchanges the refresh token for an access token", async () => {
      const client = clientWith([tokenResponse("access-9"), listResponse([])]);
      await client.catalogue("f", "My Drive");
      expect(calls[0]?.url).toBe(TOKENS);
      expect(calls[1]?.authorization).toBe("Bearer access-9");
    });

    it("reuses the access token across requests", async () => {
      const client = clientWith([tokenResponse(), listResponse([]), listResponse([])]);
      await client.catalogue("f", "My Drive");
      await client.catalogue("g", "My Drive");
      expect(calls.filter((call) => call.url === TOKENS)).toHaveLength(1);
    });

    it("refreshes once when the token has expired, then retries", async () => {
      const client = clientWith([
        tokenResponse("stale"),
        () => new Response("", { status: 401 }),
        tokenResponse("fresh"),
        listResponse([]),
      ]);
      await client.catalogue("f", "My Drive");
      expect(calls.at(-1)?.authorization).toBe("Bearer fresh");
    });

    it("reports a dead credential rather than looping", async () => {
      const client = clientWith([
        tokenResponse("stale"),
        () => new Response("", { status: 401 }),
        () => new Response("", { status: 400 }),
      ]);
      await expect(client.catalogue("f", "My Drive")).rejects.toThrow(/Connect the Drive again/);
    });

    it("reports a token response with no token", async () => {
      const client = clientWith([() => new Response(JSON.stringify({}), { status: 200 })]);
      await expect(client.catalogue("f", "My Drive")).rejects.toThrow(/did not return/);
    });
  });

  describe("retrying", () => {
    it("retries a rate limit and succeeds", async () => {
      const client = clientWith([
        tokenResponse(),
        () => new Response("", { status: 429 }),
        () => new Response("", { status: 503 }),
        listResponse([]),
      ]);
      await expect(client.catalogue("f", "My Drive")).resolves.toBeDefined();
    });

    it("does not retry a refusal that will not change", async () => {
      const client = clientWith([tokenResponse(), () => new Response("", { status: 404 })]);
      await expect(client.catalogue("f", "My Drive")).rejects.toThrow(/404/);
      // One token call and one attempt: no retry.
      expect(calls).toHaveLength(2);
    });

    it("gives up after several retries rather than hanging", async () => {
      const client = clientWith([
        tokenResponse(),
        () => new Response("", { status: 503 }),
        () => new Response("", { status: 503 }),
        () => new Response("", { status: 503 }),
        () => new Response("", { status: 503 }),
      ]);
      await expect(client.catalogue("f", "My Drive")).rejects.toThrow();
    });
  });

  describe("downloading", () => {
    it("fetches a file's bytes by identifier", async () => {
      const client = clientWith([
        tokenResponse(),
        () => new Response("mesh-bytes", { status: 200 }),
      ]);
      const bytes = await client.download("abc123");
      expect(new TextDecoder().decode(bytes)).toBe("mesh-bytes");
      expect(calls[1]?.url).toContain("/files/abc123?alt=media");
    });

    it("escapes an identifier into the URL", async () => {
      const client = clientWith([tokenResponse(), () => new Response("x", { status: 200 })]);
      await client.download("a/b c");
      expect(calls[1]?.url).toContain("a%2Fb%20c");
    });

    it("reports a refusal rather than returning empty bytes", async () => {
      const client = clientWith([tokenResponse(), () => new Response("", { status: 403 })]);
      await expect(client.download("abc")).rejects.toThrow(/403/);
    });
  });
});
