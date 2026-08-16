import type { PathUtil } from "./fileSystem.js";
import {
  deriveMoves,
  folderFor,
  QUARANTINE_FOLDER,
  type PlanModel,
} from "./planner.js";
import type { MoveReason } from "./types.js";

/** A file as it will appear in the library. */
export interface TreeFile {
  kind: "file";
  name: string;
  /** Where the file will be. */
  path: string;
  /** Where it is now. */
  sourcePath: string;
  size: number;
  reason: MoveReason;
  groupId: string;
}

/** A folder in the library, holding files and other folders. */
export interface TreeFolder {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
  /** Files anywhere beneath this folder. */
  fileCount: number;
  /** Bytes of every file beneath this folder. */
  totalBytes: number;
  /**
   * The family this folder holds, when the folder is a family's own folder.
   *
   * Purpose folders and the quarantine folder have none, which is how the
   * interface knows which folders can be renamed.
   */
  groupId: string | undefined;
}

/** Either kind of node in the tree. */
export type TreeNode = TreeFolder | TreeFile;

/** A family left alone, which contributes nothing to the library. */
export interface ExcludedGroup {
  groupId: string;
  displayName: string;
  fileCount: number;
}

/** The library as a navigable tree, plus what was left out of it. */
export interface LibraryTree {
  root: TreeFolder;
  excluded: ExcludedGroup[];
}

function emptyFolder(name: string, path: string): TreeFolder {
  return {
    kind: "folder",
    name,
    path,
    children: [],
    fileCount: 0,
    totalBytes: 0,
    groupId: undefined,
  };
}

/** Finds or creates the folder at a path, creating any missing parents. */
function folderAt(root: TreeFolder, segments: string[], path: PathUtil): TreeFolder {
  let current = root;
  for (const segment of segments) {
    const existing = current.children.find(
      (child): child is TreeFolder => child.kind === "folder" && child.name === segment,
    );
    if (existing !== undefined) {
      current = existing;
      continue;
    }
    const created = emptyFolder(segment, path.join(current.path, segment));
    current.children.push(created);
    current = created;
  }
  return current;
}

/** Adds a file's size and count to every folder above it. */
function accumulate(root: TreeFolder): void {
  let fileCount = 0;
  let totalBytes = 0;
  for (const child of root.children) {
    if (child.kind === "file") {
      fileCount += 1;
      totalBytes += child.size;
      continue;
    }
    accumulate(child);
    fileCount += child.fileCount;
    totalBytes += child.totalBytes;
  }
  root.fileCount = fileCount;
  root.totalBytes = totalBytes;
}

/** Folders first, then files, each alphabetically. */
function sortTree(folder: TreeFolder): void {
  folder.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }
    // Quarantine is the least interesting thing in the library, so it sorts
    // last rather than leading on its underscore.
    const leftQuarantine = left.name === QUARANTINE_FOLDER;
    const rightQuarantine = right.name === QUARANTINE_FOLDER;
    if (leftQuarantine !== rightQuarantine) {
      return leftQuarantine ? 1 : -1;
    }
    return left.name.localeCompare(right.name);
  });
  for (const child of folder.children) {
    if (child.kind === "folder") {
      sortTree(child);
    }
  }
}

/**
 * Builds the library as a tree of folders and files.
 *
 * The tree is derived from the plan's own moves rather than described
 * separately, so what it shows is exactly what would happen. Editing the plan
 * and rebuilding is cheap enough to do on every keystroke.
 *
 * Excluded families are reported alongside the tree rather than inside it.
 * Putting them in would mean inventing paths for files that are not going to
 * move, and those paths would be wrong as soon as a real file claimed the name.
 *
 * @param model - The plan as it currently stands
 * @param path - Path utility for the current platform
 * @returns The tree, and the families left out of it
 */
export function buildLibraryTree(model: PlanModel, path: PathUtil): LibraryTree {
  const moves = deriveMoves(model, path);
  const root = emptyFolder(path.basename(model.libraryRoot), model.libraryRoot);
  const rootSegments = path.segments(model.libraryRoot);

  for (const move of moves) {
    const segments = path.segments(move.to).slice(rootSegments.length);
    const fileName = segments.at(-1);
    if (fileName === undefined) {
      continue;
    }
    const parent = folderAt(root, segments.slice(0, -1), path);
    parent.children.push({
      kind: "file",
      name: fileName,
      path: move.to,
      sourcePath: move.from,
      size: move.size,
      reason: move.reason,
      groupId: move.groupId,
    });
  }

  // A family's own folder can be renamed; a purpose folder cannot, because it
  // is shared. Marking them here saves the interface from guessing.
  for (const group of model.groups) {
    if (group.isExcluded) {
      continue;
    }
    const groupFolder = folderFor(group, model.libraryRoot, path);
    const segments = path.segments(groupFolder).slice(rootSegments.length);
    if (segments.length === 0) {
      continue;
    }
    const folder = folderAt(root, segments, path);
    folder.groupId = group.id;
  }

  accumulate(root);
  sortTree(root);

  const excluded = model.groups
    .filter((group) => group.isExcluded)
    .map((group) => ({
      groupId: group.id,
      displayName: group.displayName,
      fileCount: group.kept.length + group.companions.length + group.duplicates.length,
    }));

  return { root, excluded };
}
