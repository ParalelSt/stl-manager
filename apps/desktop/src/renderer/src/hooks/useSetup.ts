import { useCallback, useMemo } from "react";
import { bridge } from "../bridge.js";
import { SCREEN, useAppStore } from "../store.js";

/**
 * Whether a scan root sits inside the library.
 *
 * Scanning the destination would make the application consume its own output
 * on a second run, so it is refused here rather than silently ignored by the
 * engine's exclusion rules.
 */
function isInsideLibrary(root: string, libraryRoot: string): boolean {
  return root === libraryRoot || root.startsWith(`${libraryRoot}/`);
}

/** Drives the setup screen: choosing the library and the folders to scan. */
export function useSetup() {
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const scanRoots = useAppStore((state) => state.scanRoots);
  const error = useAppStore((state) => state.error);
  const setLibraryRoot = useAppStore((state) => state.setLibraryRoot);
  const addScanRootToStore = useAppStore((state) => state.addScanRoot);
  const removeScanRoot = useAppStore((state) => state.removeScanRoot);
  const setError = useAppStore((state) => state.setError);
  const goTo = useAppStore((state) => state.goTo);

  const chooseLibraryRoot = useCallback(async () => {
    const result = await bridge().chooseDirectory();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.value !== undefined) {
      setLibraryRoot(result.value);
      setError(undefined);
    }
  }, [setError, setLibraryRoot]);

  const addScanRoot = useCallback(async () => {
    const result = await bridge().chooseDirectory();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const chosen = result.value;
    if (chosen === undefined) {
      return;
    }
    if (libraryRoot !== undefined && isInsideLibrary(chosen, libraryRoot)) {
      setError("That folder is inside the library, so scanning it would re-sort your library.");
      return;
    }
    setError(undefined);
    addScanRootToStore(chosen);
  }, [addScanRootToStore, libraryRoot, setError]);

  const isReady = useMemo(
    () => libraryRoot !== undefined && scanRoots.length > 0,
    [libraryRoot, scanRoots.length],
  );

  const start = useCallback(() => {
    if (isReady) {
      goTo(SCREEN.SCAN);
    }
  }, [goTo, isReady]);

  return {
    libraryRoot,
    scanRoots,
    error,
    isReady,
    chooseLibraryRoot,
    addScanRoot,
    removeScanRoot,
    start,
  };
}
