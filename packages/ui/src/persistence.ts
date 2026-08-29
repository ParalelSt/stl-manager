import { DEFAULT_SORTING_PROFILE, isSortingProfile, type SortingProfile } from "@stl-manager/core";

/** What survives closing the application. */
export interface RememberedChoices {
  libraryRoot: string | undefined;
  scanRoots: string[];
  profile: SortingProfile;
}

/** Where the choices are kept between visits. */
export const STORAGE_KEY = "stl-manager-choices";

/**
 * The version of the remembered shape.
 *
 * Anything stored under a different version is discarded rather than guessed
 * at. Folder choices are cheap to make again and expensive to get wrong.
 *
 * Unchanged when the layout was added, because a stored shape without one
 * still reads correctly: it falls back to the default. Bumping this would have
 * thrown away everyone's folders to add a field with an answer already.
 */
export const STORAGE_VERSION = 1;

/**
 * Picks the parts of the state worth remembering.
 *
 * The folders and the layout. The plan, progress and current screen all
 * describe a moment rather than a choice, and restoring a half-finished run
 * would be worse than starting cleanly.
 *
 * @param state - The current application state
 * @returns The choices worth keeping
 */
export function rememberedFrom(state: {
  libraryRoot: string | undefined;
  scanRoots: string[];
  profile: SortingProfile;
}): RememberedChoices {
  return {
    libraryRoot: state.libraryRoot,
    scanRoots: state.scanRoots,
    profile: state.profile,
  };
}

/**
 * Narrows whatever was stored back to usable choices.
 *
 * Storage is a file a user can edit and a format that outlives releases, so
 * what comes back is validated rather than trusted. Anything unrecognisable
 * reads as no choices at all.
 *
 * @param value - The parsed contents of storage
 * @returns The choices, with anything unusable dropped
 */
export function toRemembered(value: unknown): RememberedChoices {
  const empty: RememberedChoices = {
    libraryRoot: undefined,
    scanRoots: [],
    profile: DEFAULT_SORTING_PROFILE,
  };
  if (typeof value !== "object" || value === null) {
    return empty;
  }

  const record: Record<string, unknown> = { ...value };
  const libraryRoot = record["libraryRoot"];
  const scanRoots = record["scanRoots"];
  const profile = record["profile"];

  return {
    libraryRoot:
      typeof libraryRoot === "string" && libraryRoot !== "" ? libraryRoot : undefined,
    scanRoots: Array.isArray(scanRoots)
      ? [...new Set(scanRoots.filter((root): root is string => typeof root === "string" && root !== ""))]
      : [],
    profile:
      typeof profile === "string" && isSortingProfile(profile)
        ? profile
        : DEFAULT_SORTING_PROFILE,
  };
}
