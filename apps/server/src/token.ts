import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FileSystem, PathUtil } from "@stl-manager/core";

/** The file inside the config directory holding the access token. */
export const TOKEN_FILENAME = "token";

/** How many random bytes back a token. */
const TOKEN_BYTES = 32;

/**
 * Loads the access token, creating one on first start.
 *
 * The token lives in the config volume rather than the environment so that it
 * survives a restart without the user having to keep it anywhere. Regenerating
 * it means deleting the file.
 *
 * @param fs - Filesystem to read and write through
 * @param path - Path utility for the current platform
 * @param configDir - The directory holding the server's own state
 * @returns The token every request must present
 */
export async function ensureToken(
  fs: FileSystem,
  path: PathUtil,
  configDir: string,
): Promise<string> {
  const tokenPath = path.join(configDir, TOKEN_FILENAME);
  const existing = (await fs.readLines(tokenPath)).join("").trim();
  if (existing !== "") {
    return existing;
  }

  const token = randomBytes(TOKEN_BYTES).toString("hex");
  await fs.appendLine(tokenPath, token);
  return token;
}

/**
 * Compares a supplied token against the expected one.
 *
 * The comparison takes the same time whatever the input, so the token cannot
 * be recovered a character at a time by measuring how long a refusal takes.
 * Lengths are compared separately because the constant-time comparison itself
 * requires equal lengths.
 *
 * @param supplied - What the request presented
 * @param expected - The server's token
 * @returns True only for an exact match
 */
export function isTokenValid(supplied: string, expected: string): boolean {
  if (expected === "" || supplied.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
