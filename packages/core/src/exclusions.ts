import type { PathUtil } from "./fileSystem.js";
import { FILE_KIND, type FileKind } from "./types.js";

/**
 * Directory names the scanner never enters, wherever they appear.
 *
 * These hold tooling, caches, and application state rather than a user's own
 * models, and walking them wastes time and produces nonsense groups.
 */
export const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".cache",
  ".Trash",
  ".Trashes",
  "Library",
  "AppData",
  "$RECYCLE.BIN",
  "System Volume Information",
]);

/**
 * Absolute path roots the scanner never enters.
 *
 * Matched segment by segment, so "/Systems Design" is not caught by "/System".
 */
export const EXCLUDED_PATH_ROOTS: readonly string[] = [
  "/System",
  "/Volumes/Recovery",
  "/private/var",
  "/proc",
  "/sys",
  "/dev",
  "/usr",
  "/bin",
  "/sbin",
  "/opt/homebrew",
];

/**
 * Directory suffixes that mark a bundle.
 *
 * A bundle is a directory the operating system presents as a single file, and
 * its contents belong to an application rather than to the user.
 */
export const EXCLUDED_DIRECTORY_SUFFIXES: readonly string[] = [
  ".app",
  ".framework",
  ".bundle",
  ".photoslibrary",
  ".fcpbundle",
];

/**
 * Every extension the scanner collects, mapped to the role it plays.
 *
 * Companion formats are listed here so the scanner can recognise them, but
 * they are only ever moved alongside a model. See companions.ts.
 */
export const COLLECTED_EXTENSIONS: Readonly<Record<string, FileKind>> = {
  ".stl": FILE_KIND.MESH,
  ".obj": FILE_KIND.MESH,
  ".3mf": FILE_KIND.MESH,
  ".step": FILE_KIND.MESH,
  ".stp": FILE_KIND.MESH,
  ".ply": FILE_KIND.MESH,
  ".lys": FILE_KIND.SLICER,
  ".lychee": FILE_KIND.SLICER,
  ".chitubox": FILE_KIND.SLICER,
  ".ctb": FILE_KIND.SLICER,
  ".jpg": FILE_KIND.COMPANION,
  ".jpeg": FILE_KIND.COMPANION,
  ".png": FILE_KIND.COMPANION,
  ".webp": FILE_KIND.COMPANION,
  ".txt": FILE_KIND.COMPANION,
  ".pdf": FILE_KIND.COMPANION,
  ".md": FILE_KIND.COMPANION,
};

function startsWithSegments(path: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  return prefix.every((segment, index) => path[index] === segment);
}

/**
 * Decides whether the scanner must refuse to enter a path.
 *
 * Comparison is segment by segment rather than by string prefix, so a sibling
 * directory whose name merely begins with an excluded path is still scanned.
 *
 * @param path - Absolute path being considered
 * @param libraryRoot - The destination library, which must never be scanned
 * @param path_ - Path utility for the current platform
 * @returns True when the path must be skipped entirely
 */
export function isExcluded(path: string, libraryRoot: string, path_: PathUtil): boolean {
  const segments = path_.segments(path);

  if (startsWithSegments(segments, path_.segments(libraryRoot))) {
    return true;
  }

  for (const root of EXCLUDED_PATH_ROOTS) {
    if (startsWithSegments(segments, path_.segments(root))) {
      return true;
    }
  }

  return segments.some((segment) => {
    if (EXCLUDED_DIRECTORY_NAMES.has(segment)) {
      return true;
    }
    return EXCLUDED_DIRECTORY_SUFFIXES.some((suffix) => segment.endsWith(suffix));
  });
}
