import type { FileSystem } from "./fileSystem.js";
import type { ScannedFile } from "./types.js";

/**
 * How much of each end of a file is compared before falling back to a full
 * hash. Mesh files that differ almost always differ within their header or
 * their final triangles, so this rejects most non-duplicates cheaply.
 */
const EDGE_SAMPLE_BYTES = 64 * 1024;

/** The outcome of comparing a set of same-named files against each other. */
export interface DuplicateResolution {
  /** The file that is kept in the library. */
  winner: ScannedFile;
  /** Files byte-identical to the winner, safe to quarantine. */
  identical: ScannedFile[];
  /** Files that share the name but not the contents. These are kept. */
  divergent: ScannedFile[];
}

function newestTime(file: ScannedFile): number {
  return file.birthtimeMs > 0 ? file.birthtimeMs : file.mtimeMs;
}

/**
 * Picks which of several same-named files to keep.
 *
 * The highest duplicate index wins, then the newest file, then the path, so
 * the result never depends on the order the scan happened to produce.
 *
 * @param files - Two or more files sharing a name and extension
 * @returns The file to keep
 */
export function selectWinner(files: ScannedFile[]): ScannedFile {
  const sorted = [...files].sort((left, right) => {
    const byIndex = (right.duplicateIndex ?? 0) - (left.duplicateIndex ?? 0);
    if (byIndex !== 0) {
      return byIndex;
    }
    const byTime = newestTime(right) - newestTime(left);
    if (byTime !== 0) {
      return byTime;
    }
    return left.path.localeCompare(right.path);
  });

  const winner = sorted[0];
  if (winner === undefined) {
    throw new Error("selectWinner requires at least one file");
  }
  return winner;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
}

/**
 * Decides whether a candidate is byte-identical to the winner.
 *
 * Escalates through three increasingly expensive checks and stops at the first
 * difference: size, then both ends of the file, then a full hash. A file that
 * cannot be read is reported as not identical, so an unreadable file is never
 * quarantined on the assumption that it was a copy.
 */
async function isIdenticalTo(
  candidate: ScannedFile,
  winner: ScannedFile,
  fs: FileSystem,
): Promise<boolean> {
  if (candidate.size !== winner.size) {
    return false;
  }

  try {
    const sampleLength = Math.min(EDGE_SAMPLE_BYTES, winner.size);
    const [candidateHead, winnerHead] = await Promise.all([
      fs.readChunk(candidate.path, 0, sampleLength),
      fs.readChunk(winner.path, 0, sampleLength),
    ]);
    if (!sameBytes(candidateHead, winnerHead)) {
      return false;
    }

    if (winner.size > sampleLength) {
      const tailOffset = winner.size - sampleLength;
      const [candidateTail, winnerTail] = await Promise.all([
        fs.readChunk(candidate.path, tailOffset, sampleLength),
        fs.readChunk(winner.path, tailOffset, sampleLength),
      ]);
      if (!sameBytes(candidateTail, winnerTail)) {
        return false;
      }
    }

    const [candidateHash, winnerHash] = await Promise.all([
      fs.hash(candidate.path),
      fs.hash(winner.path),
    ]);
    return candidateHash === winnerHash;
  } catch {
    return false;
  }
}

/**
 * Resolves a set of same-named files into one winner plus the rest.
 *
 * Every other file is compared against the winner by content, never by name.
 * Files that match are safe to quarantine. Files that differ are different
 * models that happen to share a name, and are kept, because discarding them
 * on the strength of their filename would lose work irrecoverably.
 *
 * Comparison is against the winner only rather than pairwise, since the sole
 * question being asked is what may safely be set aside.
 *
 * @param files - Files sharing a name key and extension
 * @param fs - Filesystem used to read contents
 * @returns The winner, the identical copies, and the divergent files
 */
export async function resolveDuplicates(
  files: ScannedFile[],
  fs: FileSystem,
): Promise<DuplicateResolution> {
  const winner = selectWinner(files);
  const identical: ScannedFile[] = [];
  const divergent: ScannedFile[] = [];

  for (const candidate of files) {
    if (candidate.path === winner.path) {
      continue;
    }
    const isIdentical = await isIdenticalTo(candidate, winner, fs);
    if (isIdentical) {
      identical.push(candidate);
    } else {
      divergent.push(candidate);
    }
  }

  return { winner, identical, divergent };
}
