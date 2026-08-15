import type { PathUtil } from "./fileSystem.js";
import { toNameKey } from "./nameKey.js";
import { FILE_KIND, type ScannedFile } from "./types.js";

/**
 * A set of files that share a name and therefore share a folder.
 */
export interface FileGroup {
  /** Stable identifier, equal to the name key. */
  id: string;
  nameKey: string;
  /** The name shown in the interface and used for the folder on disk. */
  displayName: string;
  /** The shared parent folder, or undefined when the group stands alone. */
  purpose: string | undefined;
  files: ScannedFile[];
}

/**
 * How many distinct models a directory must contribute before its name is
 * treated as a purpose.
 *
 * A directory holding one model is not a category, it is just where that model
 * happened to sit. Without this floor the library fills with parent folders
 * holding exactly one child.
 */
const MINIMUM_NAMES_FOR_PURPOSE = 2;

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

function newestTime(file: ScannedFile): number {
  return file.birthtimeMs > 0 ? file.birthtimeMs : file.mtimeMs;
}

/**
 * Counts the distinct model names each directory contributed.
 *
 * Companions are ignored, so a readme sitting beside a single model cannot
 * turn its folder into a category.
 */
function countDistinctNamesPerDirectory(files: ScannedFile[]): Map<string, Set<string>> {
  const perDirectory = new Map<string, Set<string>>();
  for (const file of files) {
    if (file.kind === FILE_KIND.COMPANION) {
      continue;
    }
    const nameKey = toNameKey(file.stem);
    if (nameKey === "") {
      continue;
    }
    const existing = perDirectory.get(file.sourceDir);
    if (existing === undefined) {
      perDirectory.set(file.sourceDir, new Set([nameKey]));
      continue;
    }
    existing.add(nameKey);
  }
  return perDirectory;
}

/**
 * Chooses the directory a group takes its purpose from.
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

/**
 * Turns a scan inventory into groups of files that belong together.
 *
 * Files sharing a normalised name share a group. A group is given a purpose,
 * meaning a shared parent folder, only when the directory its files mostly
 * came from contributed at least two distinct model names.
 *
 * @param files - The inventory produced by a scan
 * @param path - Path utility for the current platform
 * @returns Groups sorted by display name
 */
export function group(files: ScannedFile[], path: PathUtil): FileGroup[] {
  const distinctNames = countDistinctNamesPerDirectory(files);
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

  const groups: FileGroup[] = [];

  for (const [nameKey, groupFiles] of byNameKey) {
    const displayCandidates = groupFiles.map((file) => toDisplayStem(file.stem));
    const directory = dominantDirectory(groupFiles);
    const namesInDirectory = directory === undefined ? undefined : distinctNames.get(directory);
    const hasPurpose =
      namesInDirectory !== undefined && namesInDirectory.size >= MINIMUM_NAMES_FOR_PURPOSE;

    groups.push({
      id: nameKey,
      nameKey,
      displayName: mostCommon(displayCandidates) ?? nameKey,
      purpose: hasPurpose && directory !== undefined ? path.basename(directory) : undefined,
      files: groupFiles,
    });
  }

  return groups.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/**
 * Removes a duplicate marker from a stem while keeping its original casing and
 * separators, so the library reads the way the user named things.
 */
function toDisplayStem(stem: string): string {
  const withoutMarker = stem
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .replace(/[\s._-]*copy(?:\s+\d+)?\s*$/i, "");
  return withoutMarker.trim() === "" ? stem.trim() : withoutMarker.trim();
}
