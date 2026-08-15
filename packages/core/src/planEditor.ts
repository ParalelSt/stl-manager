import type { GroupPlan, PlanModel } from "./planner.js";
import type { ScannedFile } from "./types.js";

/**
 * Characters that would change where a folder sits rather than what it is
 * called. A group name is a single folder name, never a path.
 */
const FORBIDDEN_IN_NAME = /[/\\]/;

/**
 * Checks whether a name can be used for a group or a purpose.
 *
 * @param name - The proposed name
 * @returns True when the name is usable as a single folder name
 */
export function isValidGroupName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "" || trimmed === "." || trimmed === "..") {
    return false;
  }
  return !FORBIDDEN_IN_NAME.test(trimmed);
}

function replaceGroup(
  model: PlanModel,
  groupId: string,
  change: (group: GroupPlan) => GroupPlan,
): PlanModel {
  return {
    ...model,
    groups: model.groups.map((group) => (group.id === groupId ? change(group) : group)),
  };
}

/**
 * Renames a group, which renames its folder and the files stored in it.
 *
 * An invalid name leaves the model untouched, so a half-typed name in the
 * interface cannot corrupt the plan. Callers should check isValidGroupName
 * first in order to tell the user why nothing happened.
 *
 * @param model - The plan as it currently stands
 * @param groupId - The group to rename
 * @param displayName - The new name
 * @returns A new model, or the original when the name is unusable
 */
export function renameGroup(model: PlanModel, groupId: string, displayName: string): PlanModel {
  if (!isValidGroupName(displayName)) {
    return model;
  }
  return replaceGroup(model, groupId, (group) => ({ ...group, displayName: displayName.trim() }));
}

/**
 * Sets or clears the shared parent folder a group sits under.
 *
 * @param model - The plan as it currently stands
 * @param groupId - The group to change
 * @param purpose - The parent folder name, or undefined to move the group to
 *   the library root
 * @returns A new model, or the original when the name is unusable
 */
export function setPurpose(
  model: PlanModel,
  groupId: string,
  purpose: string | undefined,
): PlanModel {
  if (purpose !== undefined && !isValidGroupName(purpose)) {
    return model;
  }
  return replaceGroup(model, groupId, (group) => ({
    ...group,
    purpose: purpose === undefined ? undefined : purpose.trim(),
  }));
}

/**
 * Excludes a group, or brings it back.
 *
 * An excluded group produces no moves at all: its files stay exactly where
 * they are, including its duplicates, which are not quarantined either.
 *
 * @param model - The plan as it currently stands
 * @param groupId - The group to change
 * @param isExcluded - Whether the group should be left alone
 * @returns A new model
 */
export function setExcluded(model: PlanModel, groupId: string, isExcluded: boolean): PlanModel {
  return replaceGroup(model, groupId, (group) => ({ ...group, isExcluded }));
}

/**
 * Merges one group into another.
 *
 * Every file moves under the target group, which keeps its own name and
 * purpose, and the source group disappears. Merging a group into itself, or
 * naming a group that is not in the model, leaves the model untouched.
 *
 * @param model - The plan as it currently stands
 * @param sourceId - The group being absorbed
 * @param targetId - The group absorbing it
 * @returns A new model, or the original when the merge is not possible
 */
export function mergeGroups(model: PlanModel, sourceId: string, targetId: string): PlanModel {
  if (sourceId === targetId) {
    return model;
  }
  const source = model.groups.find((group) => group.id === sourceId);
  const target = model.groups.find((group) => group.id === targetId);
  if (source === undefined || target === undefined) {
    return model;
  }

  const merged: GroupPlan = {
    ...target,
    kept: [...target.kept, ...source.kept],
    duplicates: [...target.duplicates, ...source.duplicates],
    companions: [...target.companions, ...source.companions],
  };

  return {
    ...model,
    groups: model.groups
      .filter((group) => group.id !== sourceId)
      .map((group) => (group.id === targetId ? merged : group)),
  };
}

function directoriesIn(group: GroupPlan): string[] {
  const directories = new Set<string>();
  for (const file of [...group.kept, ...group.duplicates, ...group.companions]) {
    directories.add(file.sourceDir);
  }
  return [...directories].sort();
}

function filesFrom(files: ScannedFile[], directory: string): ScannedFile[] {
  return files.filter((file) => file.sourceDir === directory);
}

/**
 * Splits a group into one group per source directory.
 *
 * This is the escape hatch for two genuinely different models that happen to
 * share a name. A group whose files all came from one directory cannot be
 * split, and the model is returned untouched.
 *
 * The resulting groups keep the original name, so their folders would collide;
 * the derivation resolves that by numbering them until the user renames them,
 * which is the point of splitting in the first place.
 *
 * @param model - The plan as it currently stands
 * @param groupId - The group to split
 * @returns A new model, or the original when there is nothing to split
 */
export function splitGroup(model: PlanModel, groupId: string): PlanModel {
  const group = model.groups.find((entry) => entry.id === groupId);
  if (group === undefined) {
    return model;
  }

  const directories = directoriesIn(group);
  if (directories.length < 2) {
    return model;
  }

  const pieces: GroupPlan[] = directories.map((directory, index) => ({
    ...group,
    id: `${group.id}#${index}`,
    kept: filesFrom(group.kept, directory),
    duplicates: filesFrom(group.duplicates, directory),
    companions: filesFrom(group.companions, directory),
  }));

  return {
    ...model,
    groups: model.groups.flatMap((entry) => (entry.id === groupId ? pieces : [entry])),
  };
}
