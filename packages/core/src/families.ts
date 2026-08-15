import type { PathUtil } from "./fileSystem.js";

/** One model considered for grouping. */
export interface FamilyCandidate {
  /** The normalised name, used as the family's member identity. */
  nameKey: string;
  /** The original stem, which carries the casing and separators to display. */
  stem: string;
  sourceDir: string;
}

/** A set of models that belong in one folder together. */
export interface Family {
  /** The folder name, derived from what the members share. */
  label: string;
  /** The name keys of every member. */
  nameKeys: string[];
  /**
   * True when the members were grouped because their names form a numbered
   * run rather than because they share words.
   */
  isNumberedSet: boolean;
}

/**
 * The smallest run of numbered files treated as a set.
 *
 * Two files that happen to start with a number are far more often unrelated
 * than they are a kit, so a run has to be at least this long to count.
 */
const MINIMUM_NUMBERED_RUN = 3;

/**
 * The largest leading number treated as a position in a sequence.
 *
 * Model files routinely start with a catalogue or thing identifier such as
 * 2853, which is a name rather than a position. Real kits number their parts
 * from one and rarely run past a few dozen.
 */
const MAXIMUM_SEQUENCE_NUMBER = 99;

/**
 * Splits a filename stem into comparable words.
 *
 * @param stem - Filename without its extension
 * @returns The lowercased words, with separators and empty segments removed
 */
export function toTokens(stem: string): string[] {
  return stem
    .toLowerCase()
    .split(/[_\-\s.]+/)
    .filter((token) => token !== "");
}

/**
 * Returns the opening of a stem covering its first `count` words.
 *
 * Cutting the original string rather than rejoining its words preserves the
 * spelling and the separators the user chose, so "dwarf bust" stays "dwarf
 * bust" and does not come back as "dwarf_bust".
 */
function takeLeadingTokens(stem: string, count: number): string {
  if (count <= 0) {
    return "";
  }
  const pattern = /[^_\-\s.]+/g;
  let seen = 0;
  let end = 0;
  let match = pattern.exec(stem);
  while (match !== null) {
    seen += 1;
    end = match.index + match[0].length;
    if (seen === count) {
      break;
    }
    match = pattern.exec(stem);
  }
  return stem.slice(0, end);
}

/** How many leading words two names have in common. */
function sharedLeadingTokens(left: string[], right: string[]): number {
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) {
    shared += 1;
  }
  return shared;
}

/** The leading number a stem starts with, when it looks like a position. */
function sequenceNumber(tokens: string[]): number | undefined {
  const first = tokens[0];
  if (first === undefined || !/^\d+$/.test(first)) {
    return undefined;
  }
  const value = Number.parseInt(first, 10);
  if (value > MAXIMUM_SEQUENCE_NUMBER) {
    return undefined;
  }
  return value;
}

/**
 * Decides whether a set of numbers is a run rather than a coincidence.
 *
 * A run starts at zero or one and is contiguous. Requiring that avoids
 * collecting arbitrary numbered files into a set they do not belong to.
 */
function isContiguousRun(values: number[]): boolean {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (sorted.length < MINIMUM_NUMBERED_RUN) {
    return false;
  }
  const first = sorted[0];
  if (first === undefined || first > 1) {
    return false;
  }
  return sorted.every((value, index) => value === first + index);
}

class DisjointSet {
  readonly #parent = new Map<string, string>();

  add(key: string): void {
    if (!this.#parent.has(key)) {
      this.#parent.set(key, key);
    }
  }

  find(key: string): string {
    const parent = this.#parent.get(key);
    if (parent === undefined || parent === key) {
      return key;
    }
    const root = this.find(parent);
    this.#parent.set(key, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.#parent.set(leftRoot, rightRoot);
    }
  }
}

/**
 * The longest run of words shared by every member of a family.
 *
 * The words are compared case-insensitively but the label is rebuilt from the
 * first member's own spelling, so a family of Kit_Base and Kit_Lip is called
 * "Kit" rather than "kit".
 */
function commonLabel(stems: string[]): string {
  const first = stems[0];
  if (first === undefined) {
    return "";
  }
  let common = toTokens(first);
  for (const stem of stems) {
    common = common.slice(0, sharedLeadingTokens(common, toTokens(stem)));
  }
  return takeLeadingTokens(first, common.length);
}

/**
 * Finds the numbered sets among the candidates.
 *
 * Files count as a set when they sit in one folder, each begins with a small
 * number, and those numbers form a contiguous run. The folder they came from
 * names the set, since the names themselves carry no shared word to use.
 */
function findNumberedSets(
  candidates: FamilyCandidate[],
  path: PathUtil,
): { sets: Family[]; claimed: Set<string> } {
  const byDirectory = new Map<string, { candidate: FamilyCandidate; position: number }[]>();

  for (const candidate of candidates) {
    const position = sequenceNumber(toTokens(candidate.stem));
    if (position === undefined) {
      continue;
    }
    const existing = byDirectory.get(candidate.sourceDir) ?? [];
    existing.push({ candidate, position });
    byDirectory.set(candidate.sourceDir, existing);
  }

  const sets: Family[] = [];
  const claimed = new Set<string>();

  for (const [directory, entries] of byDirectory) {
    if (!isContiguousRun(entries.map((entry) => entry.position))) {
      continue;
    }
    sets.push({
      label: path.basename(directory),
      nameKeys: entries.map((entry) => entry.candidate.nameKey),
      isNumberedSet: true,
    });
    for (const entry of entries) {
      claimed.add(entry.candidate.nameKey);
    }
  }

  return { sets, claimed };
}

/**
 * Groups models into the folders they belong in.
 *
 * Two models join a family when their names begin with the same word, applied
 * transitively, so a whole family collects even when its members share only
 * their opening. The folder is named after the longest run of words every
 * member has in common, which means the name describes the family rather than
 * being picked from one arbitrary member.
 *
 * Files whose names form a numbered run in one folder are handled separately,
 * because a kit numbered 01 to 08 shares no word at all yet is plainly one set.
 *
 * @param candidates - One entry per distinct model
 * @param path - Path utility for the current platform
 * @returns The families, each naming the members that belong to it
 */
export function groupIntoFamilies(
  candidates: FamilyCandidate[],
  path: PathUtil,
): Family[] {
  const { sets, claimed } = findNumberedSets(candidates, path);
  const remaining = candidates.filter((candidate) => !claimed.has(candidate.nameKey));

  const groups = new DisjointSet();
  for (const candidate of remaining) {
    groups.add(candidate.nameKey);
  }

  for (const left of remaining) {
    for (const right of remaining) {
      if (left.nameKey === right.nameKey) {
        continue;
      }
      if (sharedLeadingTokens(toTokens(left.stem), toTokens(right.stem)) > 0) {
        groups.union(left.nameKey, right.nameKey);
      }
    }
  }

  const members = new Map<string, FamilyCandidate[]>();
  for (const candidate of remaining) {
    const root = groups.find(candidate.nameKey);
    const existing = members.get(root) ?? [];
    existing.push(candidate);
    members.set(root, existing);
  }

  const families: Family[] = [];
  for (const group of members.values()) {
    const label = commonLabel(group.map((candidate) => candidate.stem));
    families.push({
      label: label === "" ? (group[0]?.stem ?? "") : label,
      nameKeys: group.map((candidate) => candidate.nameKey),
      isNumberedSet: false,
    });
  }

  return [...sets, ...families];
}
