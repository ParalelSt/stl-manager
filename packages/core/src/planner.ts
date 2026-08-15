import { attachCompanions } from "./companions.js";
import { resolveDuplicates } from "./duplicates.js";
import type { FileSystem, PathUtil } from "./fileSystem.js";
import { group } from "./grouper.js";
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

/**
 * One group as it will appear in the library, with its duplicates already
 * resolved.
 *
 * This is what the review screen edits. Destinations are not stored on it,
 * because they are derived from it: renaming a group or changing its purpose
 * must move every file underneath, and keeping paths here would mean keeping
 * them in step by hand.
 */
export interface GroupPlan {
  id: string;
  nameKey: string;
  /** The folder name, and the filename models are stored under. */
  displayName: string;
  /** The shared parent folder, or undefined when the group stands alone. */
  purpose: string | undefined;
  /** The winner plus any same-named files that turned out to differ. */
  kept: ScannedFile[];
  /** Files byte-identical to the winner, bound for the quarantine folder. */
  duplicates: ScannedFile[];
  companions: ScannedFile[];
  /** Excluded groups stay where they are and produce no moves. */
  isExcluded: boolean;
}

/** A complete proposal, ready to be reviewed and edited. */
export interface PlanModel {
  libraryRoot: string;
  groups: GroupPlan[];
  /** Companions and other files deliberately left where they are. */
  untouched: ScannedFile[];
  problems: Problem[];
}

/** A plan model together with the moves derived from it. */
export interface SortPlan extends PlanModel {
  moves: PlannedMove[];
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
 * Tracks claimed destinations and hands out a free one.
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

/**
 * Returns the folder a group's files are stored in.
 *
 * @param group - The group being placed
 * @param libraryRoot - The destination library
 * @param path - Path utility for the current platform
 * @returns The absolute folder path
 */
export function folderFor(group: GroupPlan, libraryRoot: string, path: PathUtil): string {
  if (group.purpose === undefined || group.purpose === "") {
    return path.join(libraryRoot, group.displayName);
  }
  return path.join(libraryRoot, group.purpose, group.displayName);
}

/**
 * Turns a reviewed plan into the list of moves that will be executed.
 *
 * Pure, and cheap enough to re-run on every edit, which is what lets the review
 * screen show real destinations while the user renames and merges groups.
 *
 * @param model - The plan as it currently stands, including any user edits
 * @param path - Path utility for the current platform
 * @returns Every move implied by the model, with collisions already resolved
 */
export function deriveMoves(model: PlanModel, path: PathUtil): PlannedMove[] {
  const destinations = new DestinationRegistry(path);
  const moves: PlannedMove[] = [];

  for (const group of model.groups) {
    if (group.isExcluded) {
      continue;
    }
    const folder = folderFor(group, model.libraryRoot, path);

    for (const file of group.kept) {
      moves.push({
        from: file.path,
        to: destinations.claim(folder, group.displayName, file.ext),
        groupId: group.id,
        reason: MOVE_REASON.MODEL,
        size: file.size,
      });
    }

    for (const companion of group.companions) {
      moves.push({
        from: companion.path,
        to: destinations.claim(folder, companion.stem, companion.ext),
        groupId: group.id,
        reason: MOVE_REASON.COMPANION,
        size: companion.size,
      });
    }

    // Quarantined copies keep their original filename, because the point of the
    // mirrored path is to show exactly where the file came from.
    for (const copy of group.duplicates) {
      const mirrored = path.join(
        model.libraryRoot,
        QUARANTINE_FOLDER,
        ...path.segments(copy.path),
      );
      moves.push({
        from: copy.path,
        to: destinations.claim(path.dirname(mirrored), copy.stem, copy.ext),
        groupId: group.id,
        reason: MOVE_REASON.DUPLICATE,
        size: copy.size,
      });
    }
  }

  return moves;
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
 * derives the moves. It reads file contents in order to compare duplicates but
 * writes nothing at all, which the accompanying tests assert directly.
 *
 * @param options - Filesystem, paths, scan roots, and the destination library
 * @returns The plan, the groups behind it, and anything left untouched
 */
export async function plan(options: PlanOptions): Promise<SortPlan> {
  const { fs, path, roots, libraryRoot, onProgress } = options;

  const scanned = await scan({
    fs,
    path,
    roots,
    libraryRoot,
    ...(onProgress ? { onProgress } : {}),
  });

  const models = scanned.files.filter((file) => file.kind !== FILE_KIND.COMPANION);
  const companionFiles = scanned.files.filter((file) => file.kind === FILE_KIND.COMPANION);

  const grouped = group(models, path);
  const assignment = attachCompanions(grouped, companionFiles);

  const groups: GroupPlan[] = [];

  for (const current of grouped) {
    const kept: ScannedFile[] = [];
    const duplicates: ScannedFile[] = [];

    for (const files of byExtension(current.files).values()) {
      const resolution = await resolveDuplicates(files, fs);
      kept.push(resolution.winner, ...resolution.divergent);
      duplicates.push(...resolution.identical);
    }

    groups.push({
      id: current.id,
      nameKey: current.nameKey,
      displayName: current.displayName,
      purpose: current.purpose,
      kept,
      duplicates,
      companions: assignment.attached.get(current.id) ?? [],
      isExcluded: false,
    });
  }

  const model: PlanModel = {
    libraryRoot,
    groups,
    untouched: assignment.untouched,
    problems: scanned.problems,
  };

  return { ...model, moves: deriveMoves(model, path) };
}
