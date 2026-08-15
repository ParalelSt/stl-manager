import { realpath } from "node:fs/promises";
import { basename, isAbsolute, resolve as resolvePath, sep } from "node:path";
import type { RootInfo } from "@stl-manager/contracts";

/** Confines every requested path to the directories the server may touch. */
export interface PathGuard {
  /**
   * Resolves a requested path and confirms it lies inside a mounted root.
   *
   * @param requested - An absolute path from a request
   * @returns The real path, with symlinks followed and "." and ".." removed
   * @throws when the path escapes the roots, does not exist, or is not usable
   */
  resolve(requested: string): Promise<string>;
  /** The roots, as the interface should offer them. */
  roots(): RootInfo[];
}

/** Splits a path into segments, so containment is tested segment by segment. */
function segmentsOf(path: string): string[] {
  return path.split(sep).filter((segment) => segment !== "");
}

function isInside(candidate: string[], root: string[]): boolean {
  if (candidate.length < root.length) {
    return false;
  }
  return root.every((segment, index) => candidate[index] === segment);
}

/**
 * Builds a guard confining requests to the given roots.
 *
 * Containment is decided after `realpath`, which removes "..", resolves every
 * symbolic link in the chain, and fails outright for a path that does not
 * exist. Checking before that would be checking a string rather than a
 * location, and a symlink inside a root could then point anywhere.
 *
 * Comparison is segment by segment rather than by string prefix, so a sibling
 * directory called "data-backup" is not treated as living inside "data". That
 * is the same mistake the scanner's exclusion rules had to avoid.
 *
 * @param roots - Absolute directories the server is permitted to reach
 * @returns The guard
 */
export function createPathGuard(roots: string[]): PathGuard {
  const rootSegments = roots.map((root) => segmentsOf(resolvePath(root)));

  return {
    async resolve(requested: string): Promise<string> {
      if (requested === "" || !isAbsolute(requested)) {
        throw new Error("A path must be absolute.");
      }
      if (requested.includes("\0")) {
        throw new Error("A path may not contain a null byte.");
      }

      let real: string;
      try {
        real = await realpath(requested);
      } catch {
        // Deliberately the same message whether the path is missing or
        // unreadable: distinguishing them tells a caller what exists outside
        // the roots.
        throw new Error("That folder is not available.");
      }

      const candidate = segmentsOf(real);
      const isAllowed = rootSegments.some((root) => isInside(candidate, root));
      if (!isAllowed) {
        // The offending path is deliberately not repeated back.
        throw new Error("That folder is outside the folders this server may read.");
      }

      return real;
    },

    roots(): RootInfo[] {
      return roots.map((root) => ({ path: root, label: basename(root) }));
    },
  };
}
