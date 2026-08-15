/**
 * A trailing "(3)" or "( 3 )", which file managers append when a name collides.
 */
const PARENTHESISED_INDEX = /\s*\(\s*(\d+)\s*\)\s*$/;

/**
 * A trailing "copy" or "copy 2", which macOS and Windows append when
 * duplicating a file in place.
 */
const COPY_SUFFIX = /[\s._-]*copy(?:\s+(\d+))?\s*$/i;

/**
 * Removes one duplicate marker from the end of a stem.
 *
 * Returns the shortened stem and the index the marker carried, or null when
 * the stem does not end in a marker at all.
 */
function stripOneMarker(stem: string): { rest: string; index: number } | null {
  const parenthesised = PARENTHESISED_INDEX.exec(stem);
  if (parenthesised !== null && parenthesised[1] !== undefined) {
    return {
      rest: stem.slice(0, parenthesised.index),
      index: Number.parseInt(parenthesised[1], 10),
    };
  }

  const copied = COPY_SUFFIX.exec(stem);
  if (copied !== null) {
    const counted = copied[1];
    return {
      rest: stem.slice(0, copied.index),
      index: counted === undefined ? 1 : Number.parseInt(counted, 10),
    };
  }

  return null;
}

/**
 * Removes every duplicate marker from the end of a stem, innermost last.
 *
 * "tower (1) copy (2)" strips to "tower", reporting 2 as the outermost index.
 */
function stripAllMarkers(stem: string): { rest: string; outermost: number | undefined } {
  let rest = stem;
  let outermost: number | undefined;

  for (;;) {
    const stripped = stripOneMarker(rest);
    if (stripped === null) {
      return { rest, outermost };
    }
    outermost ??= stripped.index;
    rest = stripped.rest;
  }
}

/**
 * Normalises a filename stem into the key used to decide which files belong
 * together.
 *
 * Lowercases, removes any duplicate markers, treats underscores, hyphens and
 * dots as spaces, then collapses and trims whitespace. A bare trailing number
 * is left alone, because "tower 2" is far more often part of a model's name
 * than a duplicate marker.
 *
 * @param stem - Filename without its extension, as it appears on disk
 * @returns The normalised key, which may be an empty string
 */
export function toNameKey(stem: string): string {
  const { rest } = stripAllMarkers(stem);
  return rest
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the duplicate index a filename stem carries, if any.
 *
 * A bare "copy" counts as index 1. Nested markers report the outermost index,
 * since that is the one most recently applied.
 *
 * @param stem - Filename without its extension, as it appears on disk
 * @returns The index, or undefined when the stem carries no duplicate marker
 */
export function parseDuplicateIndex(stem: string): number | undefined {
  return stripAllMarkers(stem).outermost;
}
