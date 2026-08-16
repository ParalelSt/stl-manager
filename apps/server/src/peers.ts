import { randomUUID } from "node:crypto";
import type { FileSystem, PathUtil } from "@stl-manager/core";

/** A machine this one has been paired with. */
export interface Peer {
  id: string;
  /** A name for the interface, taken from the address unless one was given. */
  label: string;
  /** Where the peer's server answers, for example http://192.168.1.42:8080. */
  baseUrl: string;
  /** The peer's read-only token. Grants reading its library, nothing more. */
  shareToken: string;
  /** The library on the peer to read. */
  libraryRoot: string;
}

/** The machines this one knows about. */
export interface PeerRegistry {
  list(): Promise<Peer[]>;
  get(id: string): Promise<Peer | undefined>;
  /** Adds a peer, replacing any existing one at the same address. */
  add(peer: Omit<Peer, "id">): Promise<Peer>;
  remove(id: string): Promise<void>;
}

/** The file inside the config directory holding paired machines. */
export const PEERS_FILENAME = "peers.json";

function normaliseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isPeer(value: unknown): value is Peer {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["id"] === "string" &&
    typeof record["label"] === "string" &&
    typeof record["baseUrl"] === "string" &&
    typeof record["shareToken"] === "string" &&
    typeof record["libraryRoot"] === "string"
  );
}

/**
 * Builds the registry of paired machines.
 *
 * Stored as JSON in the config volume, read on demand rather than cached: it is
 * a handful of entries that change rarely, and a user editing the file by hand
 * should not have to restart for it to take effect.
 *
 * A file that cannot be read or parsed reads as no peers rather than throwing,
 * because the config volume belongs to the user and a malformed file should not
 * stop the server starting.
 *
 * @param fs - Filesystem to read and write through
 * @param path - Path utility for the current platform
 * @param configDir - The directory holding the server's own state
 * @returns The registry
 */
export function createPeerRegistry(
  fs: FileSystem,
  path: PathUtil,
  configDir: string,
): PeerRegistry {
  const peersPath = path.join(configDir, PEERS_FILENAME);

  async function readAll(): Promise<Peer[]> {
    const lines = await fs.readLines(peersPath);
    if (lines.length === 0) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(lines.join("\n"));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isPeer);
    } catch {
      return [];
    }
  }

  async function writeAll(peers: Peer[]): Promise<void> {
    await fs.remove(peersPath);
    await fs.appendLine(peersPath, JSON.stringify(peers, null, 2));
  }

  return {
    list: readAll,

    async get(id: string): Promise<Peer | undefined> {
      return (await readAll()).find((peer) => peer.id === id);
    },

    async add(peer: Omit<Peer, "id">): Promise<Peer> {
      const baseUrl = normaliseUrl(peer.baseUrl);
      const existing = await readAll();
      const added: Peer = { ...peer, baseUrl, id: randomUUID() };
      // Pairing the same address twice replaces rather than duplicates, since
      // the second attempt is almost always a correction to the first.
      await writeAll([...existing.filter((entry) => entry.baseUrl !== baseUrl), added]);
      return added;
    },

    async remove(id: string): Promise<void> {
      const existing = await readAll();
      await writeAll(existing.filter((peer) => peer.id !== id));
    },
  };
}
