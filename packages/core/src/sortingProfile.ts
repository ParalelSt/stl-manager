/**
 * How a library is laid out.
 *
 * Chosen before a scan, because it decides the shape of the whole tree rather
 * than the fate of one file: changing it afterwards would mean re-planning
 * everything, so it is a decision taken once, up front.
 *
 * Names matter under every profile. What changes is how much they are allowed
 * to pull together, and what sits above them.
 */
export const SORTING_PROFILE = {
  /**
   * Models whose names start alike share a folder, and a source folder that
   * held several of those families becomes a parent above them.
   *
   * The default, and the one that does the most thinking on the user's behalf.
   */
  FAMILY: "family",

  /**
   * Every distinct name gets its own folder, with nothing above it.
   *
   * Nothing is merged and nothing is inferred, so the result is flat and
   * entirely predictable. For a collection whose names are already deliberate.
   */
  NAME: "name",

  /**
   * Families as above, but always kept under the folder they came from.
   *
   * For a collection already sorted into meaningful folders, where that
   * arrangement is worth keeping rather than re-deriving.
   */
  SOURCE: "source",

  /**
   * Families gathered under their file type: STL, OBJ, 3MF.
   *
   * For a collection mixing meshes with project and slicer files, where what a
   * file is matters more than where it came from.
   */
  TYPE: "type",
} as const;

/** One of the library layouts. */
export type SortingProfile = (typeof SORTING_PROFILE)[keyof typeof SORTING_PROFILE];

/** The layout used when none was chosen. */
export const DEFAULT_SORTING_PROFILE: SortingProfile = SORTING_PROFILE.FAMILY;

/** Every layout, in the order they are offered. */
export const SORTING_PROFILES: readonly SortingProfile[] = [
  SORTING_PROFILE.FAMILY,
  SORTING_PROFILE.NAME,
  SORTING_PROFILE.SOURCE,
  SORTING_PROFILE.TYPE,
];

/**
 * Narrows an untrusted string to a layout.
 *
 * @param value - A string that may name a layout
 * @returns True when it names one
 */
export function isSortingProfile(value: string): value is SortingProfile {
  return (SORTING_PROFILES as readonly string[]).includes(value);
}
