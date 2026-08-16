import { PROGRESS_KIND, type ProgressEvent } from "@stl-manager/contracts";
import type { FileSystem, PathUtil } from "@stl-manager/core";
import type { Peer } from "./peers.js";

/** What a pull needs to run. */
export interface PullOptions {
  peer: Peer;
  /** Absolute paths on the peer, as its catalogue reported them. */
  paths: string[];
  /** Where the files land. Already resolved and confined by the caller. */
  stagingDir: string;
  fs: FileSystem;
  path: PathUtil;
  fetch: typeof globalThis.fetch;
  onProgress?: (progress: ProgressEvent) => void;
}

/** What a pull achieved. */
export interface PullResult {
  fetched: number;
  /** Files already present at the same size, so not fetched again. */
  skipped: number;
  failed: { path: string; reason: string }[];
  stagingDir: string;
}

/** The suffix a file carries while it is still arriving. */
const PARTIAL_SUFFIX = ".partial";

/**
 * Reduces a path from a peer to a bare filename.
 *
 * The catalogue is data from another machine, so nothing in it is trusted to
 * build a path with. Taking only the last segment, and refusing anything that
 * is not a plain name, means a peer answering with "../../etc/passwd" can at
 * worst produce a refused entry rather than a file written outside staging.
 */
function safeFileName(remotePath: string): string | undefined {
  const segments = remotePath.split("/").filter((segment) => segment !== "");
  const name = segments.at(-1);
  if (name === undefined || name === "." || name === ".." || name.includes("\0")) {
    return undefined;
  }
  return name;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fetches files from a peer into a staging directory.
 *
 * Nothing is sorted here. The files arrive as they are, and the user then runs
 * an ordinary scan over the staging directory, so they are grouped by this
 * machine's rules and the move into the library is journalled and undoable like
 * any other.
 *
 * @param options - The peer, the paths to fetch, and where to put them
 * @returns What arrived, what was already there, and what failed
 */
export async function pullFromPeer(options: PullOptions): Promise<PullResult> {
  const { peer, paths, stagingDir, fs, path, fetch: doFetch, onProgress } = options;

  const result: PullResult = { fetched: 0, skipped: 0, failed: [], stagingDir };
  await fs.mkdir(stagingDir);

  const claimed = new Set<string>();

  for (const [index, remotePath] of paths.entries()) {
    const name = safeFileName(remotePath);
    if (name === undefined) {
      result.failed.push({ path: remotePath, reason: "That name cannot be used as a filename." });
      continue;
    }

    // Two files from different folders on the peer can share a name, so a
    // claimed name gets a numbered variant rather than overwriting.
    let finalName = name;
    for (let attempt = 2; claimed.has(finalName.toLowerCase()); attempt += 1) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      finalName = `${stem} (${attempt})${ext}`;
    }
    claimed.add(finalName.toLowerCase());

    const destination = path.join(stagingDir, finalName);
    const partial = `${destination}${PARTIAL_SUFFIX}`;

    onProgress?.({
      kind: PROGRESS_KIND.SCAN,
      done: index + 1,
      total: paths.length,
      currentPath: finalName,
    });

    try {
      const url =
        `${peer.baseUrl}/api/share/file` +
        `?libraryRoot=${encodeURIComponent(peer.libraryRoot)}` +
        `&path=${encodeURIComponent(remotePath)}`;
      const response = await doFetch(url, {
        headers: { Authorization: `Bearer ${peer.shareToken}` },
      });

      if (!response.ok) {
        result.failed.push({
          path: remotePath,
          reason: `That machine answered with status ${response.status}.`,
        });
        continue;
      }

      const expected = Number(response.headers.get("content-length") ?? "0");

      // Re-running a pull should be cheap, so anything already here at the
      // right size is left alone.
      if (await fs.exists(destination)) {
        const existing = await fs.stat(destination);
        if (expected === 0 || existing.size === expected) {
          result.skipped += 1;
          continue;
        }
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      await fs.writeBytes(partial, bytes);

      // Renamed into place only once complete, so an interrupted pull leaves
      // nothing a later scan would mistake for a real model.
      await fs.move(partial, destination);
      result.fetched += 1;
    } catch (error) {
      result.failed.push({ path: remotePath, reason: describeError(error) });
      await fs.remove(partial).catch(() => undefined);
    }
  }

  return result;
}
