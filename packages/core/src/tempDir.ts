import { mkdtemp, realpath } from "node:fs/promises";
import { join } from "node:path";

/**
 * Makes a temporary directory for a test, inside the repository.
 *
 * Not the system temporary directory, for two reasons. On macOS that resolves
 * under /private/var, which the scanner excludes as system state, so a fixture
 * placed there is invisible to a scan. And Windows has no /tmp at all, so a
 * hardcoded path fails outright.
 *
 * Keeping fixtures inside the repository also means the tests touch nothing
 * outside the project.
 *
 * @param prefix - A short name, so a stray directory says which test made it
 * @returns The real path of a fresh directory
 */
export async function makeTempDir(prefix: string): Promise<string> {
  const base = join(process.cwd(), ".tmp");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(base, { recursive: true });
  return realpath(await mkdtemp(join(base, `${prefix}-`)));
}
