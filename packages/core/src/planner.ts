import { attachCompanions } from "./companions.js";
import { resolveDuplicates } from "./duplicates.js";
import type { FileSystem, PathUtil } from "./fileSystem.js";
import { group, type FileGroup } from "./grouper.js";
import { scan } from "./scanner.js";
import { FILE_KIND, type Problem, type ScannedFile } from "./types.js";

/** Why a file is being moved. */
export const MOVE_REASON = {
  MODEL: "model",
  COMPANION: "companion",
  DUPLICATE: "duplicate",
} as const;

/** One of the reasons a move can be planned. */
export type MoveReason = (typeof MOVE_REASON)[keyof typeof MOVE_REASON];

/** A single proposed move. Nothing has happened on disk. */
export interface PlannedMove {
  from: string;
  to: string;
  groupId: string;
  reason: MoveReason;
  /** Size in bytes, used by the applier to check free space before writing. */
  size: number;
}

/** A complete proposal, ready to be reviewed and edited. */
export interface SortPlan {
  libraryRoot: string;
  moves: PlannedMove[];
  groups: FileGroup[];
  /** Companions and other files deliberately left where they are. */
  untouched: ScannedFile[];
  problems: Problem[];
}

/** Everything needed to build a plan. */
export interface PlanOptions {
  fs: FileSystem;
  path: PathUtil;
  roots: string[];
  libraryRoot: string;
  onProgress?: (count: number, currentPath: string) => void;
}

/** The folder inside the library where losing duplicates are quarantined. */
export const QUARANTINE_FOLDER = "_Duplicates";

/**
 * Tracks planned destinations and hands out a free one.
 *
 * Comparison is case-insensitive, because macOS treats Tower.stl and tower.stl
 * as the same path while Linux does not. Planning against the stricter of the
 * two means a library built on one machine still makes sense on the other.
 */
class DestinationRegistry {
  readonly #taken = new Set<string>();

  constructor(private readonly path: PathUtil) {}

  claim(directory: string, stem: string, ext: string): string {
    for (let attempt = 1; ; attempt += 1) {
      const suffix = attempt === 1 ? "" : ` (${attempt})`;
      const candidate = this.path.join(directory, `${stem}${suffix}${ext}`);
      const key = candidate.toLowerCase();
      if (!this.#taken.has(key)) {
        this.#taken.add(key);
        return candidate;
      }
    }
  }
}

function folderFor(group: FileGroup, libraryRoot: string, path: PathUtil): string {
  if (group.purpose === undefined) {
    return path.join(libraryRoot, group.displayName);
  }
  return path.join(libraryRoot, group.purpose, group.displayName);
}

/**
 * Groups a set of files by extension, since a duplicate of a .stl is not a
 * duplicate of the .obj sitting beside it.
 */
function byExtension(files: ScannedFile[]): Map<string, ScannedFile[]> {
  const map = new Map<string, ScannedFile[]>();
  for (const file of files) {
    const existing = map.get(file.ext);
    if (existing === undefined) {
      map.set(file.ext, [file]);
      continue;
    }
    existing.push(file);
  }
  return map;
}

/**
 * Builds a complete proposal for reorganising the scanned files.
 *
 * Runs the scan, grouping, duplicate resolution and companion attachment, then
 * turns the result into a list of moves. It reads file contents in order to
 * compare duplicates but writes nothing at all, which the accompanying tests
 * assert directly.
 *
 * @param options - Filesystem, paths, scan roots, and the destination library
 * @returns The plan, the groups behind it, and anything left untouched
 */
export async function plan(options: PlanOptions): Promise<SortPlan> {
  const { fs, path, roots, libraryRoot, onProgress } = options;

  const scanned = await scan({ fs, path, roots, libraryRoot, ...(onProgress ? { onProgress } : {}) });

  const models = scanned.files.filter((file) => file.kind !== FILE_KIND.COMPANION);
  const companions = scanned.files.filter((file) => file.kind === FILE_KIND.COMPANION);

  const groups = group(models, path);
  const assignment = attachCompanions(groups, companions);

  const destinations = new DestinationRegistry(path);
  const moves: PlannedMove[] = [];

  for (const currentGroup of groups) {
    const folder = folderFor(currentGroup, libraryRoot, path);

    for (const [ext, files] of byExtension(currentGroup.files)) {
      const resolution = await resolveDuplicates(files, fs);

      for (const kept of [resolution.winner, ...resolution.divergent]) {
        moves.push({
          from: kept.path,
          to: destinations.claim(folder, currentGroup.displayName, ext),
          groupId: currentGroup.id,
          reason: MOVE_REASON.MODEL,
          size: kept.size,
        });
      }

      // Quarantined copies keep their original filename, because the whole
      // point of the mirrored path is to show where the file came from.
      for (const copy of resolution.identical) {
        const mirrored = path.join(libraryRoot, QUARANTINE_FOLDER, ...path.segments(copy.path));
        moves.push({
          from: copy.path,
          to: destinations.claim(path.dirname(mirrored), copy.stem, ext),
          groupId: currentGroup.id,
          reason: MOVE_REASON.DUPLICATE,
          size: copy.size,
        });
      }
    }

    for (const companion of assignment.attached.get(currentGroup.id) ?? []) {
      moves.push({
        from: companion.path,
        to: destinations.claim(folder, companion.stem, companion.ext),
        groupId: currentGroup.id,
        reason: MOVE_REASON.COMPANION,
        size: companion.size,
      });
    }
  }

  return {
    libraryRoot,
    moves,
    groups,
    untouched: assignment.untouched,
    problems: scanned.problems,
  };
}
