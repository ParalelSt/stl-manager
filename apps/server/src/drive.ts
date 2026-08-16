import { COLLECTED_EXTENSIONS } from "@stl-manager/core";
import type { TreeFile, TreeFolder } from "@stl-manager/core";

/** What is needed to reach a Drive on the user's behalf. */
export interface DriveCredentials {
  clientId: string;
  clientSecret: string;
  /** The long-lived credential, exchanged for short-lived access tokens. */
  refreshToken: string;
}

/** How the client talks to Google. */
export interface DriveOptions {
  credentials: DriveCredentials;
  fetch?: typeof globalThis.fetch;
  /** Endpoints, overridden by tests. */
  apiBase?: string;
  tokenUrl?: string;
  /** Delay between retries, shortened by tests. */
  retryDelayMs?: number;
}

/** Reads a Google Drive on the user's behalf. Never writes. */
export interface DriveClient {
  /** Lists model files in a folder as a catalogue the interface can render. */
  catalogue(folderId: string, label: string): Promise<TreeFolder>;
  /** Fetches one file's bytes by its Drive identifier. */
  download(fileId: string): Promise<Uint8Array>;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

/** Drive's own folder type. Everything else is a file. */
const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Google's own formats have no bytes to download, so they are skipped. */
const GOOGLE_FORMAT_PREFIX = "application/vnd.google-apps.";

const DEFAULT_API_BASE = "https://www.googleapis.com/drive/v3";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Statuses worth trying again. Everything else is reported as it is. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** True for a file this application would collect from a disk. */
function isCollectable(file: DriveFile): boolean {
  if (file.mimeType === FOLDER_MIME || file.mimeType.startsWith(GOOGLE_FORMAT_PREFIX)) {
    return false;
  }
  return COLLECTED_EXTENSIONS[extensionOf(file.name)] !== undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds a read-only client for one Google Drive.
 *
 * The access token is short-lived and fetched on demand from the refresh
 * token, so nothing long-lived is held in memory longer than it must be, and
 * an expired token recovers by itself rather than failing the operation.
 *
 * @param options - Credentials, and the endpoints and clock tests override
 * @returns The client
 */
export function createDriveClient(options: DriveOptions): DriveClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const apiBase = options.apiBase ?? DEFAULT_API_BASE;
  const tokenUrl = options.tokenUrl ?? DEFAULT_TOKEN_URL;
  const retryDelayMs = options.retryDelayMs ?? 500;

  let accessToken: string | undefined;

  async function refreshAccessToken(): Promise<string> {
    const response = await doFetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.credentials.clientId,
        client_secret: options.credentials.clientSecret,
        refresh_token: options.credentials.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(
        "Google refused the stored credential. Connect the Drive again to renew it.",
      );
    }
    const body: unknown = await response.json();
    const record: Record<string, unknown> =
      typeof body === "object" && body !== null ? { ...body } : {};
    const token = record["access_token"];
    if (typeof token !== "string" || token === "") {
      throw new Error("Google did not return an access token.");
    }
    accessToken = token;
    return token;
  }

  /**
   * Makes a request, refreshing the token once if it has expired.
   *
   * The refresh is attempted only once per call: a credential that is genuinely
   * dead would otherwise loop.
   */
  async function authorised(url: string): Promise<Response> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const token = accessToken ?? (await refreshAccessToken());
      const response = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (response.status === 401 && attempt === 1) {
        accessToken = undefined;
        continue;
      }
      if (RETRYABLE.has(response.status) && attempt < MAX_ATTEMPTS) {
        // Drive rate-limits, and a pull of many files is worth finishing
        // slowly rather than abandoning.
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
        continue;
      }
      return response;
    }
    throw new Error("Google did not answer after several attempts.");
  }

  return {
    async catalogue(folderId: string, label: string): Promise<TreeFolder> {
      const files: TreeFile[] = [];
      let pageToken: string | undefined;

      do {
        const query = new URLSearchParams({
          q: `'${folderId.replace(/'/g, "")}' in parents and trashed = false`,
          fields: "nextPageToken, files(id, name, mimeType, size)",
          pageSize: "200",
        });
        if (pageToken !== undefined) {
          query.set("pageToken", pageToken);
        }

        const response = await authorised(`${apiBase}/files?${query.toString()}`);
        if (!response.ok) {
          throw new Error(`Google answered with status ${response.status}.`);
        }

        const body: unknown = await response.json();
        const record: Record<string, unknown> =
          typeof body === "object" && body !== null ? { ...body } : {};
        const listed = Array.isArray(record["files"]) ? (record["files"] as DriveFile[]) : [];

        for (const file of listed) {
          if (!isCollectable(file)) {
            continue;
          }
          files.push({
            kind: "file",
            name: file.name,
            // A Drive file has an identifier rather than a path, so that is
            // what the catalogue carries and what a pull asks for.
            path: file.id,
            sourcePath: file.id,
            size: Number(file.size ?? "0"),
            reason: "model",
            groupId: "",
          });
        }

        const next = record["nextPageToken"];
        pageToken = typeof next === "string" ? next : undefined;
      } while (pageToken !== undefined);

      files.sort((left, right) => left.name.localeCompare(right.name));

      return {
        kind: "folder",
        name: label,
        path: folderId,
        children: files,
        fileCount: files.length,
        totalBytes: files.reduce((total, file) => total + file.size, 0),
        groupId: undefined,
      };
    },

    async download(fileId: string): Promise<Uint8Array> {
      const response = await authorised(
        `${apiBase}/files/${encodeURIComponent(fileId)}?alt=media`,
      );
      if (!response.ok) {
        throw new Error(`Google answered with status ${response.status}.`);
      }
      try {
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        throw new Error(`That file could not be read: ${describeError(error)}`);
      }
    },
  };
}
