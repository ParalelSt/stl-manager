import type { FileSystem, PathUtil } from "./fileSystem.js";
import { STATE_FOLDER } from "./journal.js";
import type { TreeFolder, TreeNode } from "./libraryTree.js";
import { MOVE_REASON } from "./planner.js";

/**
 * Reads an existing library from disk as a tree.
 *
 * Used after a plan has been applied, when the interesting thing is what is
 * really there rather than what was planned. The whole tree is read in one
 * pass: a library is a single directory walk, which the scanner already does
 * over far larger trees without trouble, and reading it lazily per folder
 * would add a round trip per expansion for no gain at this size.
 *
 * The application's own state folder is skipped, since the journal is not part
 * of the collection.
 *
 * @param fs - Filesystem to read through
 * @param path - Path utility for the current platform
 * @param libraryRoot - The library to read
 * @returns The tree, with counts and sizes filled in
 */
export async function readLibraryTree(
  fs: FileSystem,
  path: PathUtil,
  libraryRoot: string,
): Promise<TreeFolder> {
  async function readFolder(directory: string, name: string): Promise<TreeFolder> {
    const folder: TreeFolder = {
      kind: "folder",
      name,
      path: directory,
      children: [],
      fileCount: 0,
      totalBytes: 0,
      groupId: undefined,
    };

    let entries;
    try {
      entries = await fs.list(directory);
    } catch {
      return folder;
    }

    const children: TreeNode[] = [];
    for (const entry of entries) {
      if (entry.name === STATE_FOLDER || entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory) {
        children.push(await readFolder(entry.path, entry.name));
        continue;
      }
      try {
        const stats = await fs.stat(entry.path);
        children.push({
          kind: "file",
          name: entry.name,
          path: entry.path,
          sourcePath: entry.path,
          size: stats.size,
          reason: MOVE_REASON.MODEL,
          groupId: "",
        });
      } catch {
        continue;
      }
    }

    folder.children = children.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "folder" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    for (const child of children) {
      if (child.kind === "file") {
        folder.fileCount += 1;
        folder.totalBytes += child.size;
        continue;
      }
      folder.fileCount += child.fileCount;
      folder.totalBytes += child.totalBytes;
    }

    return folder;
  }

  return readFolder(libraryRoot, path.basename(libraryRoot));
}
