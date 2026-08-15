import type { PathUtil } from "./fileSystem.js";

function splitSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

/**
 * A PathUtil using forward slashes.
 *
 * Correct on macOS and Linux, which are the platforms this application
 * targets, and used by the engine's tests so they need no real filesystem.
 */
export const posixPath: PathUtil = {
  join(...segments: string[]): string {
    const isRooted = segments[0]?.startsWith("/") ?? false;
    const joined = segments
      .flatMap((segment) => splitSegments(segment))
      .join("/");
    return isRooted ? `/${joined}` : joined;
  },

  dirname(path: string): string {
    const index = path.lastIndexOf("/");
    if (index < 0) {
      return ".";
    }
    if (index === 0) {
      return "/";
    }
    return path.slice(0, index);
  },

  basename(path: string): string {
    return splitSegments(path).at(-1) ?? "";
  },

  extname(path: string): string {
    const base = posixPath.basename(path);
    const index = base.lastIndexOf(".");
    if (index <= 0) {
      return "";
    }
    return base.slice(index);
  },

  relative(from: string, to: string): string {
    const fromSegments = splitSegments(from);
    const toSegments = splitSegments(to);
    let shared = 0;
    while (
      shared < fromSegments.length &&
      shared < toSegments.length &&
      fromSegments[shared] === toSegments[shared]
    ) {
      shared += 1;
    }
    const up = Array.from({ length: fromSegments.length - shared }, () => "..");
    return [...up, ...toSegments.slice(shared)].join("/");
  },

  isAbsolute(path: string): boolean {
    return path.startsWith("/");
  },

  segments(path: string): string[] {
    return splitSegments(path);
  },
};
