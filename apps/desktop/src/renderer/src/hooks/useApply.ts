import { deriveMoves, posixPath } from "@stl-manager/core";
import { useCallback, useMemo, useState } from "react";
import { bridge } from "../bridge.js";
import { SCREEN, useAppStore } from "../store.js";

/**
 * Drives the apply screen.
 *
 * This is the only place in the application that writes to disk, so starting
 * is gated behind an explicit confirmation rather than a single click.
 */
export function useApply() {
  const plan = useAppStore((state) => state.plan);
  const progress = useAppStore((state) => state.progress);
  const applied = useAppStore((state) => state.applied);
  const error = useAppStore((state) => state.error);
  const setProgress = useAppStore((state) => state.setProgress);
  const setApplied = useAppStore((state) => state.setApplied);
  const setError = useAppStore((state) => state.setError);
  const goTo = useAppStore((state) => state.goTo);

  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const moves = useMemo(
    () => (plan === undefined ? [] : deriveMoves(plan, posixPath)),
    [plan],
  );

  const confirm = useCallback(() => {
    setIsConfirmed(true);
  }, []);

  const start = useCallback(async () => {
    if (!isConfirmed || plan === undefined || isApplying) {
      return;
    }
    setIsApplying(true);
    setProgress(undefined);
    setError(undefined);

    const unsubscribe = bridge().onProgress((event) => {
      setProgress(event);
    });

    try {
      const result = await bridge().applyPlan({ libraryRoot: plan.libraryRoot, moves });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApplied(result.value);
    } finally {
      unsubscribe();
      setIsApplying(false);
    }
  }, [isApplying, isConfirmed, moves, plan, setApplied, setError, setProgress]);

  const back = useCallback(() => {
    goTo(SCREEN.REVIEW);
  }, [goTo]);

  const viewHistory = useCallback(() => {
    goTo(SCREEN.HISTORY);
  }, [goTo]);

  return {
    moves,
    progress,
    applied,
    error,
    isConfirmed,
    isApplying,
    confirm,
    start,
    back,
    viewHistory,
  };
}
