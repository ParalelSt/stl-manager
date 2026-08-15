import { useCallback, useEffect, useState } from "react";
import { useHost } from "../host.js";
import { SCREEN, useAppStore } from "../store.js";

/** Drives the history screen: past runs, and reversing one. */
export function useHistory() {
  const { transport } = useHost();
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const runs = useAppStore((state) => state.runs);
  const error = useAppStore((state) => state.error);
  const setRuns = useAppStore((state) => state.setRuns);
  const setError = useAppStore((state) => state.setError);
  const goTo = useAppStore((state) => state.goTo);

  const [pendingUndoId, setPendingUndoId] = useState<string | undefined>(undefined);
  const [isWorking, setIsWorking] = useState(false);

  const refresh = useCallback(async () => {
    if (libraryRoot === undefined) {
      return;
    }
    const result = await transport.listRuns({ libraryRoot });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRuns(result.value);
  }, [libraryRoot, setError, setRuns]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const askToUndo = useCallback((runId: string) => {
    setPendingUndoId(runId);
  }, []);

  const cancelUndo = useCallback(() => {
    setPendingUndoId(undefined);
  }, []);

  const confirmUndo = useCallback(async () => {
    if (libraryRoot === undefined || pendingUndoId === undefined) {
      return;
    }
    setIsWorking(true);
    try {
      const result = await transport.undoRun({ libraryRoot, runId: pendingUndoId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPendingUndoId(undefined);
      await refresh();
    } finally {
      setIsWorking(false);
    }
  }, [libraryRoot, pendingUndoId, refresh, setError]);

  const startOver = useCallback(() => {
    goTo(SCREEN.SETUP);
  }, [goTo]);

  return {
    runs,
    error,
    pendingUndoId,
    isWorking,
    askToUndo,
    cancelUndo,
    confirmUndo,
    startOver,
  };
}
