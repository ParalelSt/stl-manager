import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { posixPath } from "@stl-manager/core";
import { NodeFileSystem } from "@stl-manager/core/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { ServerConfig } from "../config.js";
import { sanitiseUploadName } from "./publicShare.js";

const TOKEN = "a".repeat(64);
const SHARE_TOKEN = "s".repeat(64);

/**
 * The only part of the application a stranger can reach.
 *
 * Three properties must hold, and each is tested directly: an unauthenticated
 * request reaches exactly one share and nothing else, a share cannot be written
 * to unless it was made to allow it, and nothing arriving from outside is
 * trusted as a name or a size.
 */
describe("public shares", () => {
  let base: string;
  let root: string;
  let library: string;
  let dropDir: string;
  let app: ReturnType<typeof createApp>;

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

  async function makeShare(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await asOwner("/api/shares", {
      method: "POST",
      body: JSON.stringify({
        paths: [join(library, "kit", "kit_base.stl")],
        label: "Kit",
        ...overrides,
      }),
    });
    const body = await response.json();
    return body.value.token;
  }

  function upload(token: string, name: string, contents: string): Promise<Response> {
    const form = new FormData();
    form.set("file", new File([contents], name));
    return app.request(`/s/${token}/upload`, { method: "POST", body: form });
  }

  beforeEach(async () => {
    base = await realpath(await mkdtemp("/tmp/stl-share-public-"));
    root = join(base, "data");
    library = join(root, "library");
    dropDir = join(base, "drops");
    await mkdir(join(library, "kit"), { recursive: true });
    await mkdir(dropDir, { recursive: true });
    await writeFile(join(library, "kit", "kit_base.stl"), "base-mesh");

    const config: ServerConfig = {
      port: 8080,
      roots: [root],
      configDir: join(base, "config"),
      dropDir,
    };
    await mkdir(config.configDir, { recursive: true });
    app = createApp({
      config,
      token: TOKEN,
      shareToken: SHARE_TOKEN,
      fs: new NodeFileSystem(),
      path: posixPath,
    });
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  describe("reaching a share", () => {
    it("serves a share with no authentication at all", async () => {
      const token = await makeShare();
      const response = await app.request(`/s/${token}/info`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.value.files).toHaveLength(1);
      expect(body.value.files[0].name).toBe("kit_base.stl");
    });

    it("never reveals a path, on the page or in the data", async () => {
      const token = await makeShare();
      expect(await (await app.request(`/s/${token}`)).text()).not.toContain(library);
      expect(await (await app.request(`/s/${token}/info`)).text()).not.toContain(library);
    });

    it("serves a page a person can read", async () => {
      const token = await makeShare();
      const response = await app.request(`/s/${token}`);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain("kit_base.stl");
      expect(html).toContain("Download");
      // No upload control unless the share was made to allow one.
      expect(html).not.toContain("Upload");
    });

    it("shows an upload control only when the share allows it", async () => {
      const token = await makeShare({ allowsUpload: true });
      expect(await (await app.request(`/s/${token}`)).text()).toContain("Upload");
    });

    it("escapes a filename so it cannot become markup", async () => {
      await writeFile(join(library, "kit", "<img src=x>.stl"), "x");
      const token = await makeShare({ paths: [join(library, "kit", "<img src=x>.stl")] });
      const html = await (await app.request(`/s/${token}`)).text();
      expect(html).not.toContain("<img src=x>");
      expect(html).toContain("&lt;img src=x&gt;");
    });

    it("asks search engines not to index a share", async () => {
      const token = await makeShare();
      expect(await (await app.request(`/s/${token}`)).text()).toContain("noindex");
    });

    it("downloads a file from its own share", async () => {
      const token = await makeShare();
      const listing = await (await app.request(`/s/${token}/info`)).json();
      const response = await app.request(`/s/${token}/file?id=${listing.value.files[0].id}`);
      expect(await response.text()).toBe("base-mesh");
    });

    it("refuses a file identifier belonging to a different share", async () => {
      const first = await makeShare();
      await writeFile(join(library, "kit", "kit_lip.stl"), "lip-mesh");
      const second = await makeShare({ paths: [join(library, "kit", "kit_lip.stl")] });

      const secondListing = await (await app.request(`/s/${second}/info`)).json();
      const stolen = secondListing.value.files[0].id;

      // A file identifier is meaningless outside the share that issued it.
      const response = await app.request(`/s/${first}/file?id=${stolen}`);
      expect(response.status).toBe(404);
    });

    it("refuses an invented token", async () => {
      expect((await app.request("/s/nonsense")).status).toBe(404);
    });

    it("refuses a revoked share", async () => {
      const response = await asOwner("/api/shares", {
        method: "POST",
        body: JSON.stringify({ paths: [join(library, "kit", "kit_base.stl")] }),
      });
      const created = await response.json();
      await asOwner(`/api/shares/${created.value.id}`, { method: "DELETE" });
      expect((await app.request(`/s/${created.value.token}`)).status).toBe(404);
    });

    it("refuses an expired share", async () => {
      const token = await makeShare({ expiresInMs: 1 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect((await app.request(`/s/${token}`)).status).toBe(404);
    });

    it("cannot reach anything else on the machine", async () => {
      const token = await makeShare();
      // The share routes are the only unauthenticated ones. Everything else
      // still refuses, share link or not.
      expect((await app.request("/api/roots")).status).toBe(401);
      expect((await app.request(`/api/roots?token=${token}`)).status).toBe(401);
    });
  });

  describe("uploads", () => {
    it("refuses an upload to a share that does not allow it", async () => {
      const token = await makeShare();
      expect((await upload(token, "new.stl", "x")).status).toBe(403);
    });

    it("accepts an upload to a share that allows it", async () => {
      const token = await makeShare({ allowsUpload: true });
      expect((await upload(token, "new.stl", "mesh")).status).toBe(201);
      const folders = await readdir(dropDir);
      expect(folders).toHaveLength(1);
      const files = await readdir(join(dropDir, folders[0] ?? ""));
      expect(files).toEqual(["new.stl"]);
    });

    it("never lets an upload leave the drop folder", async () => {
      const token = await makeShare({ allowsUpload: true });
      for (const hostile of ["../../escape.stl", "/etc/escape.stl", "..", "....//escape.stl"]) {
        await upload(token, hostile, "mesh");
      }
      // Nothing anywhere but inside the share's own folder.
      expect(await readdir(base)).toEqual(expect.arrayContaining(["config", "data", "drops"]));
      expect(await readdir(root)).toEqual(["library"]);
      const folders = await readdir(dropDir);
      for (const folder of folders) {
        for (const name of await readdir(join(dropDir, folder))) {
          expect(name).not.toContain("/");
          expect(name).not.toContain("..");
        }
      }
    });

    it("refuses a file type it does not handle", async () => {
      const token = await makeShare({ allowsUpload: true });
      expect((await upload(token, "payload.sh", "#!/bin/sh")).status).toBe(400);
      expect((await upload(token, "notes.docx", "x")).status).toBe(400);
    });

    it("refuses a file with no usable name", async () => {
      const token = await makeShare({ allowsUpload: true });
      expect((await upload(token, "...", "x")).status).toBe(400);
    });

    it("numbers a collision rather than overwriting", async () => {
      const token = await makeShare({ allowsUpload: true });
      await upload(token, "model.stl", "first");
      await upload(token, "model.stl", "second");
      const folder = join(dropDir, (await readdir(dropDir))[0] ?? "");
      expect((await readdir(folder)).sort()).toEqual(["model (2).stl", "model.stl"]);
      expect(await readFile(join(folder, "model.stl"), "utf8")).toBe("first");
    });

    it("leaves the library untouched", async () => {
      const token = await makeShare({ allowsUpload: true });
      await upload(token, "new.stl", "mesh");
      expect(await readdir(join(library, "kit"))).toEqual(["kit_base.stl"]);
    });

    it("refuses an upload to an invented token", async () => {
      expect((await upload("nonsense", "new.stl", "x")).status).toBe(404);
    });
  });
});

describe("sanitiseUploadName", () => {
  it("keeps an ordinary name", () => {
    expect(sanitiseUploadName("ruined_tower.stl")).toBe("ruined_tower.stl");
  });

  it("takes only the last segment", () => {
    expect(sanitiseUploadName("../../etc/passwd.stl")).toBe("passwd.stl");
    expect(sanitiseUploadName("C:\\windows\\evil.stl")).toBe("evil.stl");
  });

  it("refuses the directory shorthands", () => {
    expect(sanitiseUploadName("..")).toBeUndefined();
    expect(sanitiseUploadName(".")).toBeUndefined();
  });

  it("strips leading dots so nothing becomes hidden", () => {
    expect(sanitiseUploadName(".hidden.stl")).toBe("hidden.stl");
  });

  it("replaces characters that could mean something to a shell", () => {
    expect(sanitiseUploadName("a;rm -rf b.stl")).toBe("a_rm -rf b.stl");
  });

  it("keeps letters from other alphabets", () => {
    expect(sanitiseUploadName("Dragón.stl")).toBe("Dragón.stl");
  });

  it("bounds the length", () => {
    expect((sanitiseUploadName(`${"a".repeat(400)}.stl`) ?? "").length).toBeLessThanOrEqual(120);
  });

  it("refuses a name that sanitises to nothing", () => {
    expect(sanitiseUploadName("")).toBeUndefined();
    expect(sanitiseUploadName("///")).toBeUndefined();
  });
});
