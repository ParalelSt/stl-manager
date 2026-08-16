import { JOB_KIND, type ProgressEvent, PROGRESS_KIND } from "@stl-manager/contracts";
import type { FileSystem, PathUtil } from "@stl-manager/core";
import { Hono } from "hono";
import { createDriveClient, type DriveCredentials } from "../drive.js";
import type { JobRegistry } from "../jobs.js";
import type { PathGuard } from "../pathGuard.js";

/** What the Drive routes need. */
export interface DriveRouteOptions {
  guard: PathGuard;
  jobs: JobRegistry;
  fs: FileSystem;
  path: PathUtil;
  configDir: string;
  fetch?: typeof globalThis.fetch;
}

/** The file inside the config directory holding the Drive credential. */
export const DRIVE_FILENAME = "google-drive.json";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCredentials(value: unknown): value is DriveCredentials {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["clientId"] === "string" &&
    typeof record["clientSecret"] === "string" &&
    typeof record["refreshToken"] === "string"
  );
}

/**
 * Reduces a Drive filename to something safe to write.
 *
 * A Drive name is data from a service, not a path. Only a bare name survives,
 * so a file called "../../etc/passwd" lands as "passwd" inside staging.
 */
export function safeDriveName(name: string): string | undefined {
  const last = name.split(/[/\\]/).filter((part) => part !== "").at(-1);
  if (last === undefined || last === "." || last === ".." || last.includes("\0")) {
    return undefined;
  }
  const cleaned = last.replace(/^\.+/, "").trim().slice(0, 200);
  return cleaned === "" ? undefined : cleaned;
}

/**
 * Routes for reading a Google Drive.
 *
 * Drive is treated as another peer: something to browse and take copies from.
 * The application asks for a read-only scope, so the credential it holds is
 * incapable of changing anything in the Drive.
 *
 * @param options - The guard, jobs, filesystem and config directory
 * @returns The routes, to be mounted under /api
 */
export function driveRoutes(options: DriveRouteOptions): Hono {
  const { guard, jobs, fs, path, configDir } = options;
  const routes = new Hono();
  const credentialPath = path.join(configDir, DRIVE_FILENAME);

  async function readCredentials(): Promise<DriveCredentials | undefined> {
    const lines = await fs.readLines(credentialPath);
    if (lines.length === 0) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(lines.join("\n"));
      return isCredentials(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  routes.get("/drive", async (context) => {
    const credentials = await readCredentials();
    // Never returns the credential itself, only whether one is present.
    return context.json({ ok: true, value: { isConnected: credentials !== undefined } });
  });

  routes.put("/drive", async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    if (!isCredentials(body)) {
      return context.json(
        { ok: false, error: "A client id, client secret and refresh token are required." },
        400,
      );
    }
    await fs.remove(credentialPath);
    await fs.appendLine(credentialPath, JSON.stringify(body, null, 2));
    return context.json({ ok: true, value: { isConnected: true } });
  });

  routes.delete("/drive", async (context) => {
    await fs.remove(credentialPath);
    return context.json({ ok: true, value: { isConnected: false } });
  });

  routes.get("/drive/catalogue", async (context) => {
    const credentials = await readCredentials();
    if (credentials === undefined) {
      return context.json({ ok: false, error: "No Drive is connected." }, 400);
    }
    const folderId = context.req.query("folderId") ?? "root";
    try {
      const client = createDriveClient({
        credentials,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
      return context.json({ ok: true, value: await client.catalogue(folderId, "Google Drive") });
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }
  });

  routes.post("/drive/pulls", async (context) => {
    const credentials = await readCredentials();
    if (credentials === undefined) {
      return context.json({ ok: false, error: "No Drive is connected." }, 400);
    }

    const body: unknown = await context.req.json().catch(() => null);
    const record: Record<string, unknown> =
      typeof body === "object" && body !== null ? { ...body } : {};
    const files = record["files"];
    const stagingDir = record["stagingDir"];

    if (!Array.isArray(files) || typeof stagingDir !== "string" || stagingDir === "") {
      return context.json({ ok: false, error: "A staging folder and files are required." }, 400);
    }

    let staging: string;
    try {
      staging = await guard.resolve(stagingDir);
    } catch (error) {
      return context.json({ ok: false, error: describeError(error) }, 400);
    }

    const wanted = files
      .filter(
        (entry): entry is { id: string; name: string } =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { name?: unknown }).name === "string",
      )
      .map((entry) => ({ id: entry.id, name: entry.name }));

    const client = createDriveClient({
      credentials,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });

    const jobId = jobs.start(JOB_KIND.SCAN, async (report) => {
      const result = {
        fetched: 0,
        skipped: 0,
        failed: [] as { path: string; reason: string }[],
        stagingDir: staging,
      };
      await fs.mkdir(staging);
      const claimed = new Set<string>();

      for (const [index, file] of wanted.entries()) {
        const safe = safeDriveName(file.name);
        if (safe === undefined) {
          result.failed.push({ path: file.name, reason: "That name cannot be used." });
          continue;
        }

        let finalName = safe;
        for (let attempt = 2; claimed.has(finalName.toLowerCase()); attempt += 1) {
          const dot = safe.lastIndexOf(".");
          const stem = dot > 0 ? safe.slice(0, dot) : safe;
          const ext = dot > 0 ? safe.slice(dot) : "";
          finalName = `${stem} (${attempt})${ext}`;
        }
        claimed.add(finalName.toLowerCase());

        const destination = path.join(staging, finalName);
        const partial = `${destination}.partial`;

        const progress: ProgressEvent = {
          kind: PROGRESS_KIND.SCAN,
          done: index + 1,
          total: wanted.length,
          currentPath: finalName,
        };
        report(progress);

        try {
          if (await fs.exists(destination)) {
            result.skipped += 1;
            continue;
          }
          const bytes = await client.download(file.id);
          await fs.writeBytes(partial, bytes);
          await fs.move(partial, destination);
          result.fetched += 1;
        } catch (error) {
          result.failed.push({ path: file.name, reason: describeError(error) });
          await fs.remove(partial).catch(() => undefined);
        }
      }

      return result;
    });

    return context.json({ ok: true, value: { jobId } }, 202);
  });

  return routes;
}
