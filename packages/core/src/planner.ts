import { attachCompanions } from "./companions.js";
import { resolveDuplicates } from "./duplicates.js";
import type { FileSystem, PathUtil } from "./fileSystem.js";
import { group } from "./grouper.js";
import { toNameKey } from "./nameKey.js";
import { readLibraryTree } from "./readLibraryTree.js";
import { scan } from "./scanner.js";
import { DEFAULT_SORTING_PROFILE, type SortingProfile } from "./sortingProfile.js";
import {
  FILE_KIND,
  MOVE_REASON,
  type MoveReason,
  type Problem,
  type ScannedFile,
} from "./types.js";

export { MOVE_REASON, type MoveReason };

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
  /** The folder name for the family. */
  displayName: string;
  /** The shared parent folder, or undefined when the group stands alone. */
  purpose: string | undefined;
  /** The winner plus any same-named files that turned out to differ. */
  kept: ScannedFile[];
  /** Files byte-identical to the winner, bound for the quarantine folder. */
  duplicates: ScannedFile[];
  companions: ScannedFile[];
  /** True when the family was recognised by its numbering, not its words. */
  isNumberedSet: boolean;
  /** Excluded groups stay where they are and produce no moves. */
  isExcluded: boolean;
}

/** A complete proposal, ready to be reviewed and edited. */
export interface PlanModel {
  libraryRoot: string;
  /**
   * The layout this plan was built for.
   *
   * Carried so the review screen can say which one produced these folders. It
   * is not consulted when deriving moves: by that point the layout has already
   * become the groups and their purposes.
   */
  profile: SortingProfile;
  /** The folders that were scanned, used to keep quarantine paths short. */
  scanRoots: string[];
  /**
   * Paths the library already holds.
   *
   * Claimed before anything else, so a second run never proposes a
   * destination that is already occupied. Carried on the model rather than
   * recomputed, so it survives the user editing the plan.
   */
  occupied: string[];
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
  /** The library layout to build. Defaults to grouping by family. */
  profile?: SortingProfile;
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

  constructor(
    private readonly path: PathUtil,
    occupied: string[] = [],
  ) {
    for (const entry of occupied) {
      this.#taken.add(entry.toLowerCase());
    }
  }

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
 * Returns a path relative to whichever scan root contains it.
 *
 * Quarantined copies mirror where they came from, but mirroring an absolute
 * path buries every file under the whole of /Users/someone/Downloads. Relative
 * to the folder the user actually chose to scan, the origin is still obvious
 * and the tree stays readable.
 */
function relativeToRoot(filePath: string, scanRoots: string[], path: PathUtil): string[] {
  const segments = path.segments(filePath);
  let best: string[] | undefined;
  for (const root of scanRoots) {
    const rootSegments = path.segments(root);
    const isInside = rootSegments.every((segment, index) => segments[index] === segment);
    if (!isInside) {
      continue;
    }
    const remainder = segments.slice(rootSegments.length);
    if (best === undefined || remainder.length < best.length) {
      best = remainder;
    }
  }
  return best ?? segments;
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
  const destinations = new DestinationRegistry(path, model.occupied);
  const moves: PlannedMove[] = [];

  for (const group of model.groups) {
    if (group.isExcluded) {
      continue;
    }
    const folder = folderFor(group, model.libraryRoot, path);

    // A family holds several models, and a model can be several files: a mesh,
    // its supports, a preview, a slicer file. Those belong together in a
    // folder of their own. A model that is a single file does not need one,
    // which is what keeps a family of ten lone models from becoming ten
    // folders holding one file each.
    const byModel = new Map<string, { kept: ScannedFile[]; companions: ScannedFile[] }>();
    for (const file of group.kept) {
      const key = toNameKey(file.stem);
      const entry = byModel.get(key) ?? { kept: [], companions: [] };
      entry.kept.push(file);
      byModel.set(key, entry);
    }
    for (const companion of group.companions) {
      const key = toNameKey(companion.stem);
      const entry = byModel.get(key) ?? { kept: [], companions: [] };
      entry.companions.push(companion);
      byModel.set(key, entry);
    }

    for (const entry of byModel.values()) {
      const first = entry.kept[0] ?? entry.companions[0];
      if (first === undefined) {
        continue;
      }
      const modelName = cleanStem(first.stem);
      const total = entry.kept.length + entry.companions.length;

      // A model gets its own folder only when it is several files AND the
      // family holds more than one model. A family of one model is already
      // that model's folder, and nesting again would give space_marine a
      // space_marine folder inside a space_marine folder.
      const needsOwnFolder =
        total > 1 && byModel.size > 1 && modelName.toLowerCase() !== group.displayName.toLowerCase();
      const home = needsOwnFolder ? path.join(folder, modelName) : folder;

      for (const file of entry.kept) {
        moves.push({
          from: file.path,
          to: destinations.claim(home, cleanStem(file.stem), file.ext),
          groupId: group.id,
          reason: MOVE_REASON.MODEL,
          size: file.size,
        });
      }

      for (const companion of entry.companions) {
        moves.push({
          from: companion.path,
          to: destinations.claim(home, companion.stem, companion.ext),
          groupId: group.id,
          reason: MOVE_REASON.COMPANION,
          size: companion.size,
        });
      }
    }

    // Quarantined copies keep their original filename, because the point of the
    // mirrored path is to show exactly where the file came from.
    for (const copy of group.duplicates) {
      const mirrored = path.join(
        model.libraryRoot,
        QUARANTINE_FOLDER,
        ...relativeToRoot(copy.path, model.scanRoots, path),
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
 * Strips a duplicate marker from a stem, keeping its original spelling.
 *
 * A file keeps its own name in the library. Only the folder is named after the
 * family, because a family holds several distinct models: naming every file
 * after the family would turn kit_base and kit_lip into two files both called
 * kit.
 */
function cleanStem(stem: string): string {
  const withoutMarker = stem
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/[\s._-]*copy(?:\s+\d+)?\s*$/i, "");
  return withoutMarker.trim() === "" ? stem.trim() : withoutMarker.trim();
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
  const profile = options.profile ?? DEFAULT_SORTING_PROFILE;

  const scanned = await scan({
    fs,
    path,
    roots,
    libraryRoot,
    ...(onProgress ? { onProgress } : {}),
  });

  const models = scanned.files.filter((file) => file.kind !== FILE_KIND.COMPANION);
  const companionFiles = scanned.files.filter((file) => file.kind === FILE_KIND.COMPANION);

  const grouped = group(models, path, profile);
  const assignment = attachCompanions(grouped, companionFiles);

  const groups: GroupPlan[] = [];

  for (const current of grouped) {
    const kept: ScannedFile[] = [];
    const duplicates: ScannedFile[] = [];

    // Within a family the members are different models, so duplicates are
    // resolved per model per extension. Comparing kit_base against kit_lip
    // would be both meaningless and expensive.
    const byModel = new Map<string, ScannedFile[]>();
    for (const file of current.files) {
      const key = toNameKey(file.stem);
      const existing = byModel.get(key);
      if (existing === undefined) {
        byModel.set(key, [file]);
        continue;
      }
      existing.push(file);
    }

    for (const modelFiles of byModel.values()) {
      for (const files of byExtension(modelFiles).values()) {
        const resolution = await resolveDuplicates(files, fs);
        kept.push(resolution.winner, ...resolution.divergent);
        duplicates.push(...resolution.identical);
      }
    }

    groups.push({
      id: current.id,
      displayName: current.displayName,
      purpose: current.purpose,
      isNumberedSet: current.isNumberedSet,
      kept,
      duplicates,
      companions: assignment.attached.get(current.id) ?? [],
      isExcluded: false,
    });
  }

  // What the library already holds, so a second run cannot land on top of it.
  const existing = await readLibraryTree(fs, path, libraryRoot);
  const occupied: string[] = [];
  const collect = (node: { kind: string; path: string; children?: unknown[] }): void => {
    if (node.kind === "file") {
      occupied.push(node.path);
      return;
    }
    for (const child of (node.children ?? []) as typeof node[]) {
      collect(child);
    }
  };
  collect(existing);

  const model: PlanModel = {
    libraryRoot,
    profile,
    scanRoots: roots,
    occupied,
    groups,
    untouched: assignment.untouched,
    problems: scanned.problems,
  };

  return { ...model, moves: deriveMoves(model, path) };
}
