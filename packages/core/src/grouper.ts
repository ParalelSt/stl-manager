import { groupIntoFamilies, type FamilyCandidate } from "./families.js";
import type { PathUtil } from "./fileSystem.js";
import { toNameKey } from "./nameKey.js";
import {
  DEFAULT_SORTING_PROFILE,
  SORTING_PROFILE,
  type SortingProfile,
} from "./sortingProfile.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

/**
 * A family of related models, which share one folder in the library.
 *
 * A family usually holds several distinct models, not several copies of one:
 * kit_base, kit_lip and kit_straight are one family and three models.
 */
export interface FileGroup {
  /** Stable identifier for the family. */
  id: string;
  /** The folder name, and how the family is shown. */
  displayName: string;
  /** The shared parent folder, or undefined when the family stands alone. */
  purpose: string | undefined;
  /** True when the family was recognised by its numbering rather than its words. */
  isNumberedSet: boolean;
  files: ScannedFile[];
}

/**
 * Folder names that describe where files landed rather than what they are.
 *
 * Turning one of these into a category produces a library sorted under a
 * heading like "Downloads", which tells the user nothing they did not already
 * know and buries the real structure a level deeper.
 */
const UNINFORMATIVE_FOLDER_NAMES: ReadonlySet<string> = new Set([
  "downloads",
  "download",
  "desktop",
  "documents",
  "home",
  "models",
  "model",
  "stl",
  "stls",
  "files",
  "file",
  "3d",
  "3d models",
  "3d prints",
  "prints",
  "print",
  "printing",
  "new folder",
  "untitled",
  "temp",
  "tmp",
  "misc",
  "unsorted",
  "archive",
  "archives",
  "extracted",
  "zip",
  "zips",
  "shared",
  "public",
]);

/**
 * How many distinct families a folder must contribute before its name is
 * treated as a purpose.
 */
const MINIMUM_FAMILIES_FOR_PURPOSE = 2;

/**
 * The name given to a numbered set whose folder name says nothing useful.
 *
 * A numbered set has no shared word to name itself with, so it borrows its
 * folder's name. When that folder is called something like "Downloads" there
 * is nothing to borrow, and the honest thing is to say so and let the user
 * name it in review.
 */
const UNNAMED_NUMBERED_SET = "Numbered set";

/**
 * Names the file type a family mostly consists of, as a folder name.
 *
 * Model files decide it. A family of meshes with a readme beside them is a
 * family of meshes, and filing it under TXT would be absurd.
 */
function typeLabel(files: ScannedFile[]): string | undefined {
  const models = files.filter((file) => file.kind !== FILE_KIND.COMPANION);
  const deciding = models.length > 0 ? models : files;
  const label = mostCommon(
    deciding.map((file) => file.ext.replace(/^\./, "").toUpperCase()).filter((ext) => ext !== ""),
  );
  return label === "" ? undefined : label;
}

function newestTime(file: ScannedFile): number {
  return file.birthtimeMs > 0 ? file.birthtimeMs : file.mtimeMs;
}

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Removes a duplicate marker from a stem while keeping its original casing.
 */
function toDisplayStem(stem: string): string {
  const withoutMarker = stem
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/[\s._-]*copy(?:\s+\d+)?\s*$/i, "");
  return withoutMarker.trim() === "" ? stem.trim() : withoutMarker.trim();
}

/**
 * Chooses the directory a family takes its purpose from.
 *
 * The directory contributing the most files wins, with the newest file
 * breaking a tie.
 */
function dominantDirectory(files: ScannedFile[]): string | undefined {
  const counts = new Map<string, { count: number; newest: number }>();
  for (const file of files) {
    const existing = counts.get(file.sourceDir) ?? { count: 0, newest: 0 };
    counts.set(file.sourceDir, {
      count: existing.count + 1,
      newest: Math.max(existing.newest, newestTime(file)),
    });
  }

  let best: string | undefined;
  let bestCount = 0;
  let bestNewest = 0;
  for (const [directory, stats] of counts) {
    const isBetter =
      stats.count > bestCount || (stats.count === bestCount && stats.newest > bestNewest);
    if (isBetter) {
      best = directory;
      bestCount = stats.count;
      bestNewest = stats.newest;
    }
  }
  return best;
}

/** Everything the purpose decision depends on, for one family. */
interface PurposeContext {
  profile: SortingProfile;
  files: ScannedFile[];
  /** The name of the folder the family mostly came from. */
  folderName: string;
  /** False when that folder name only says where files landed. */
  isInformative: boolean;
  /** How many whole families that folder produced. */
  familyCount: number;
  isNumberedSet: boolean;
}

/**
 * Chooses the parent folder a family sits under, if any.
 *
 * This is where the chosen layout does most of its work: the folders a library
 * grows are decided here and by whether names were merged into families at all.
 */
function purposeFor(context: PurposeContext): string | undefined {
  const { profile, folderName, isInformative, familyCount, isNumberedSet } = context;

  if (profile === SORTING_PROFILE.NAME) {
    return undefined;
  }
  if (profile === SORTING_PROFILE.TYPE) {
    return typeLabel(context.files);
  }

  // A numbered set is already named after its folder, so nesting it inside a
  // folder of the same name would just repeat itself.
  if (isNumberedSet || !isInformative || folderName === "") {
    return undefined;
  }

  // Keeping the source arrangement means trusting a folder that produced a
  // single family, which the default deliberately does not.
  const required =
    profile === SORTING_PROFILE.SOURCE ? 1 : MINIMUM_FAMILIES_FOR_PURPOSE;
  return familyCount >= required ? folderName : undefined;
}

/**
 * Turns a scan inventory into families of related models.
 *
 * Models whose names begin with the same word belong together, applied
 * transitively so a whole family collects. Files numbered in a run within one
 * folder are recognised as a set even though their names share nothing.
 *
 * A family is given a purpose, meaning a shared parent folder, only when the
 * folder its files mostly came from is both informative and held at least two
 * distinct families. A folder called "Downloads" says nothing about what is in
 * it, so it never becomes a category.
 *
 * All of that describes the default layout. Another may keep every name apart,
 * always honour the folder a file came from, or file everything under its type
 * instead; names still decide what a folder is called under all of them.
 *
 * @param files - The inventory produced by a scan
 * @param path - Path utility for the current platform
 * @param profile - The library layout to build
 * @returns Families sorted by display name
 */
export function group(
  files: ScannedFile[],
  path: PathUtil,
  profile: SortingProfile = DEFAULT_SORTING_PROFILE,
): FileGroup[] {
  const byNameKey = new Map<string, ScannedFile[]>();
  for (const file of files) {
    const nameKey = toNameKey(file.stem);
    if (nameKey === "") {
      continue;
    }
    const existing = byNameKey.get(nameKey);
    if (existing === undefined) {
      byNameKey.set(nameKey, [file]);
      continue;
    }
    existing.push(file);
  }

  const candidates: FamilyCandidate[] = [];
  for (const [nameKey, group] of byNameKey) {
    // Companions never define a family. A readme sitting beside one model must
    // not count as a second thing in the folder, or every folder holding a
    // model and its notes would become a category.
    const models = group.filter((file) => file.kind !== FILE_KIND.COMPANION);
    const representative = models[0];
    if (representative === undefined) {
      continue;
    }
    candidates.push({
      nameKey,
      stem: toDisplayStem(representative.stem),
      sourceDir: dominantDirectory(group) ?? representative.sourceDir,
    });
  }

  // One folder per name means no merging at all: every candidate stands as its
  // own family, so nothing is pulled together by a shared first word.
  const families =
    profile === SORTING_PROFILE.NAME
      ? candidates.map((candidate) => ({
          label: candidate.stem,
          nameKeys: [candidate.nameKey],
          isNumberedSet: false,
        }))
      : groupIntoFamilies(candidates, path);

  // A folder only counts towards a purpose when it produced whole families,
  // so a folder holding one family and its parts is not a category.
  const familiesPerDirectory = new Map<string, Set<string>>();
  for (const family of families) {
    const familyFiles = family.nameKeys.flatMap((key) => byNameKey.get(key) ?? []);
    const directory = dominantDirectory(familyFiles);
    if (directory === undefined) {
      continue;
    }
    const existing = familiesPerDirectory.get(directory);
    if (existing === undefined) {
      familiesPerDirectory.set(directory, new Set([family.label]));
      continue;
    }
    existing.add(family.label);
  }

  const groups: FileGroup[] = [];

  for (const family of families) {
    const familyFiles = family.nameKeys.flatMap((key) => byNameKey.get(key) ?? []);
    if (familyFiles.length === 0) {
      continue;
    }

    const directory = dominantDirectory(familyFiles);
    const folderName = directory === undefined ? "" : path.basename(directory);
    const isInformative = !UNINFORMATIVE_FOLDER_NAMES.has(folderName.toLowerCase());
    const familyCount = directory === undefined ? 0 : (familiesPerDirectory.get(directory)?.size ?? 0);

    const purpose = purposeFor({
      profile,
      files: familyFiles,
      folderName,
      isInformative,
      familyCount,
      isNumberedSet: family.isNumberedSet,
    });

    const displayName = (() => {
      if (family.isNumberedSet) {
        return isInformative && family.label !== "" ? family.label : UNNAMED_NUMBERED_SET;
      }
      if (family.label !== "") {
        return family.label;
      }
      return mostCommon(familyFiles.map((file) => toDisplayStem(file.stem))) ?? "Unnamed";
    })();

    groups.push({
      id: family.nameKeys.join("|"),
      displayName,
      purpose,
      isNumberedSet: family.isNumberedSet,
      files: familyFiles,
    });
  }

  return groups.sort((left, right) => left.displayName.localeCompare(right.displayName));
}
