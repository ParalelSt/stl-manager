import { toNameKey } from "./nameKey.js";
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

function partitionByModel(
  files: ScannedFile[],
  nameKey: string,
): { matching: ScannedFile[]; rest: ScannedFile[] } {
  const matching: ScannedFile[] = [];
  const rest: ScannedFile[] = [];
  for (const file of files) {
    if (toNameKey(file.stem) === nameKey) {
      matching.push(file);
    } else {
      rest.push(file);
    }
  }
  return { matching, rest };
}

function isEmpty(group: GroupPlan): boolean {
  return (
    group.kept.length === 0 && group.duplicates.length === 0 && group.companions.length === 0
  );
}

/**
 * Moves one model, with every file belonging to it, into another family.
 *
 * A model is identified by its normalised name rather than by a single file,
 * because one model is usually several files: a mesh, its slicer file and its
 * preview all travel together. Moving only the file the user dragged would
 * split them.
 *
 * A family left with nothing is removed, since an empty folder in the library
 * would be meaningless.
 *
 * @param model - The plan as it currently stands
 * @param nameKey - The normalised name of the model to move
 * @param targetGroupId - The family it should join
 * @returns A new model, or the original when the move is not possible
 */
export function moveModelToGroup(
  model: PlanModel,
  nameKey: string,
  targetGroupId: string,
): PlanModel {
  const target = model.groups.find((group) => group.id === targetGroupId);
  if (target === undefined) {
    return model;
  }

  const moved = { kept: [] as ScannedFile[], duplicates: [] as ScannedFile[], companions: [] as ScannedFile[] };
  const stripped: GroupPlan[] = [];

  for (const group of model.groups) {
    if (group.id === targetGroupId) {
      stripped.push(group);
      continue;
    }
    const kept = partitionByModel(group.kept, nameKey);
    const duplicates = partitionByModel(group.duplicates, nameKey);
    const companions = partitionByModel(group.companions, nameKey);

    moved.kept.push(...kept.matching);
    moved.duplicates.push(...duplicates.matching);
    moved.companions.push(...companions.matching);

    stripped.push({
      ...group,
      kept: kept.rest,
      duplicates: duplicates.rest,
      companions: companions.rest,
    });
  }

  const hasAnything =
    moved.kept.length > 0 || moved.duplicates.length > 0 || moved.companions.length > 0;
  if (!hasAnything) {
    return model;
  }

  return {
    ...model,
    groups: stripped
      .map((group) =>
        group.id === targetGroupId
          ? {
              ...group,
              kept: [...group.kept, ...moved.kept],
              duplicates: [...group.duplicates, ...moved.duplicates],
              companions: [...group.companions, ...moved.companions],
            }
          : group,
      )
      .filter((group) => group.id === targetGroupId || !isEmpty(group)),
  };
}
