import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge.js";
import { SCREEN, useAppStore } from "../store.js";

/**
 * Runs the scan and plan, streaming progress while it works.
 *
 * Nothing is written during this. The result is a proposal the user reviews.
 */
export function useScan() {
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const scanRoots = useAppStore((state) => state.scanRoots);
  const progress = useAppStore((state) => state.progress);
  const error = useAppStore((state) => state.error);
  const setPlan = useAppStore((state) => state.setPlan);
  const setProgress = useAppStore((state) => state.setProgress);
  const setError = useAppStore((state) => state.setError);
  const goTo = useAppStore((state) => state.goTo);

  const [isScanning, setIsScanning] = useState(false);
  const hasStarted = useRef(false);

  const run = useCallback(async () => {
    if (libraryRoot === undefined || scanRoots.length === 0) {
      return;
    }
    setIsScanning(true);
    setProgress(undefined);

    const unsubscribe = bridge().onProgress((event) => {
      setProgress(event);
    });

    try {
      const result = await bridge().buildPlan({ roots: scanRoots, libraryRoot });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPlan(result.value);
      goTo(SCREEN.REVIEW);
    } finally {
      unsubscribe();
      setIsScanning(false);
    }
  }, [goTo, libraryRoot, scanRoots, setError, setPlan, setProgress]);

  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;
    void run();
  }, [run]);

  const cancel = useCallback(() => {
    goTo(SCREEN.SETUP);
  }, [goTo]);

  return { isScanning, progress, error, cancel, retry: run };
}
