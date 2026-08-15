import {
  deriveMoves,
  isValidGroupName,
  mergeGroups,
  posixPath,
  renameGroup,
  setExcluded,
  setPurpose,
  splitGroup,
  type GroupPlan,
  type PlanModel,
  type PlannedMove,
} from "@stl-manager/core";
import { useCallback, useMemo } from "react";
import { SCREEN, useAppStore } from "../store.js";

/** A group together with where its files will actually land. */
export interface ReviewGroup extends GroupPlan {
  /** The folder this group's files move into. */
  destinationFolder: string;
  /** How many files the group will move in total. */
  fileCount: number;
}

/** Totals shown alongside the tree so the run can be judged at a glance. */
export interface ReviewSummary {
  groupCount: number;
  moveCount: number;
  duplicateCount: number;
  excludedCount: number;
  totalBytes: number;
}

function folderOf(moves: PlannedMove[], groupId: string): string {
  const first = moves.find((move) => move.groupId === groupId);
  if (first === undefined) {
    return "";
  }
  return posixPath.dirname(first.to);
}

/**
 * Drives the review screen.
 *
 * Every edit produces a new plan model and re-derives the moves, so the
 * destinations on screen are always the ones that would actually be executed
 * rather than an approximation kept in step by hand.
 */
export function useReview() {
  const plan = useAppStore((state) => state.plan);
  const setPlan = useAppStore((state) => state.setPlan);
  const goTo = useAppStore((state) => state.goTo);

  const moves = useMemo(
    () => (plan === undefined ? [] : deriveMoves(plan, posixPath)),
    [plan],
  );

  const groups = useMemo((): ReviewGroup[] => {
    if (plan === undefined) {
      return [];
    }
    return plan.groups.map((group) => ({
      ...group,
      destinationFolder: folderOf(moves, group.id),
      fileCount: group.kept.length + group.companions.length + group.duplicates.length,
    }));
  }, [moves, plan]);

  const summary = useMemo((): ReviewSummary => {
    return {
      groupCount: groups.length,
      moveCount: moves.length,
      duplicateCount: groups.reduce((total, group) => total + group.duplicates.length, 0),
      excludedCount: groups.filter((group) => group.isExcluded).length,
      totalBytes: moves.reduce((total, move) => total + move.size, 0),
    };
  }, [groups, moves]);

  const edit = useCallback(
    (change: (model: PlanModel) => PlanModel) => {
      if (plan === undefined) {
        return;
      }
      setPlan(change(plan));
    },
    [plan, setPlan],
  );

  const rename = useCallback(
    (groupId: string, name: string) => {
      edit((model) => renameGroup(model, groupId, name));
    },
    [edit],
  );

  const changePurpose = useCallback(
    (groupId: string, purpose: string | undefined) => {
      edit((model) => setPurpose(model, groupId, purpose));
    },
    [edit],
  );

  const toggleExcluded = useCallback(
    (groupId: string, isExcluded: boolean) => {
      edit((model) => setExcluded(model, groupId, isExcluded));
    },
    [edit],
  );

  const merge = useCallback(
    (sourceId: string, targetId: string) => {
      edit((model) => mergeGroups(model, sourceId, targetId));
    },
    [edit],
  );

  const split = useCallback(
    (groupId: string) => {
      edit((model) => splitGroup(model, groupId));
    },
    [edit],
  );

  const back = useCallback(() => {
    goTo(SCREEN.SETUP);
  }, [goTo]);

  const proceed = useCallback(() => {
    goTo(SCREEN.APPLY);
  }, [goTo]);

  return {
    plan,
    groups,
    moves,
    summary,
    isNameValid: isValidGroupName,
    rename,
    changePurpose,
    toggleExcluded,
    merge,
    split,
    back,
    proceed,
  };
}
