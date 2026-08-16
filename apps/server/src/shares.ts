import { randomBytes, randomUUID } from "node:crypto";
import type { FileSystem, PathUtil } from "@stl-manager/core";

/** One file offered by a share. */
export interface SharedFile {
  /** Stable identifier used in links, so paths never appear in a URL. */
  id: string;
  /** Absolute path on this machine. */
  path: string;
  /** The name shown, and used if the file is downloaded. */
  name: string;
  size: number;
}

/** A named selection of files, offered at one link. */
export interface Share {
  id: string;
  /** The secret in the link. Long, random, and revocable. */
  token: string;
  label: string;
  files: SharedFile[];
  createdAt: number;
  /** Milliseconds since the epoch, or undefined for a share that never expires. */
  expiresAt: number | undefined;
  /** Whether the recipient may send files back. Off unless asked for. */
  allowsUpload: boolean;
  /** Largest single upload accepted, in bytes. */
  maxUploadBytes: number;
  /** Largest total this share will ever accept, in bytes. */
  maxTotalBytes: number;
  /** How much has been uploaded so far. */
  uploadedBytes: number;
}

/** The shares this machine is offering. */
export interface ShareRegistry {
  list(): Promise<Share[]>;
  /** Finds a share by the token in its link, if it is still valid. */
  byToken(token: string, now: number): Promise<Share | undefined>;
  create(share: Omit<Share, "id" | "token" | "createdAt" | "uploadedBytes">): Promise<Share>;
  revoke(id: string): Promise<void>;
  /** Records bytes accepted, so a share's total cap can be enforced. */
  recordUpload(id: string, bytes: number): Promise<void>;
}

/** The file inside the config directory holding shares. */
export const SHARES_FILENAME = "shares.json";

/** How long a share lasts unless another expiry is asked for. */
export const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Bytes in a single upload, unless a share asks for a different limit. */
export const DEFAULT_MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** Bytes across all uploads to one share, unless it asks for different. */
export const DEFAULT_MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

const TOKEN_BYTES = 24;

function isShare(value: unknown): value is Share {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["id"] === "string" &&
    typeof record["token"] === "string" &&
    typeof record["label"] === "string" &&
    Array.isArray(record["files"]) &&
    typeof record["createdAt"] === "number" &&
    typeof record["allowsUpload"] === "boolean"
  );
}

/**
 * Builds the registry of shares this machine offers.
 *
 * A share is a snapshot: it records the files it was made from, so adding a
 * model to the library later cannot silently widen a link somebody already
 * has.
 *
 * @param fs - Filesystem to read and write through
 * @param path - Path utility for the current platform
 * @param configDir - The directory holding the server's own state
 * @returns The registry
 */
export function createShareRegistry(
  fs: FileSystem,
  path: PathUtil,
  configDir: string,
): ShareRegistry {
  const sharesPath = path.join(configDir, SHARES_FILENAME);

  async function readAll(): Promise<Share[]> {
    const lines = await fs.readLines(sharesPath);
    if (lines.length === 0) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(lines.join("\n"));
      return Array.isArray(parsed) ? parsed.filter(isShare) : [];
    } catch {
      return [];
    }
  }

  async function writeAll(shares: Share[]): Promise<void> {
    await fs.remove(sharesPath);
    await fs.appendLine(sharesPath, JSON.stringify(shares, null, 2));
  }

  return {
    list: readAll,

    async byToken(token: string, now: number): Promise<Share | undefined> {
      if (token === "") {
        return undefined;
      }
      const share = (await readAll()).find((entry) => entry.token === token);
      if (share === undefined) {
        return undefined;
      }
      // An expired share behaves exactly like one that never existed, so a
      // stale link cannot be distinguished from a wrong one.
      if (share.expiresAt !== undefined && share.expiresAt <= now) {
        return undefined;
      }
      return share;
    },

    async create(share): Promise<Share> {
      const created: Share = {
        ...share,
        id: randomUUID(),
        token: randomBytes(TOKEN_BYTES).toString("hex"),
        createdAt: Date.now(),
        uploadedBytes: 0,
      };
      await writeAll([...(await readAll()), created]);
      return created;
    },

    async revoke(id: string): Promise<void> {
      await writeAll((await readAll()).filter((share) => share.id !== id));
    },

    async recordUpload(id: string, bytes: number): Promise<void> {
      const shares = await readAll();
      await writeAll(
        shares.map((share) =>
          share.id === id ? { ...share, uploadedBytes: share.uploadedBytes + bytes } : share,
        ),
      );
    },
  };
}
