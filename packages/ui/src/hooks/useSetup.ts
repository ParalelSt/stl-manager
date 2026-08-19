import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OperationResult } from "@stl-manager/contracts";
import { useHost } from "../host.js";
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
  const { transport, chooseDirectory: chooseFromPlatform } = useHost();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerResolve = useRef<((path: string | undefined) => void) | undefined>(undefined);

  /**
   * Asks the user for a folder.
   *
   * Uses the platform's own dialog when the host supplies one, and otherwise
   * opens the interface's own directory browser. That fallback is the only
   * place the desktop and browser builds diverge.
   */
  const chooseFolder = useCallback(async (): Promise<OperationResult<string | undefined>> => {
    if (chooseFromPlatform !== undefined) {
      return chooseFromPlatform();
    }
    setIsPickerOpen(true);
    const chosen = await new Promise<string | undefined>((resolve) => {
      pickerResolve.current = resolve;
    });
    setIsPickerOpen(false);
    return { ok: true, value: chosen };
  }, [chooseFromPlatform]);

  const resolvePicker = useCallback((path: string | undefined) => {
    pickerResolve.current?.(path);
    pickerResolve.current = undefined;
  }, []);
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const scanRoots = useAppStore((state) => state.scanRoots);
  const error = useAppStore((state) => state.error);
  const setLibraryRoot = useAppStore((state) => state.setLibraryRoot);
  const addScanRootToStore = useAppStore((state) => state.addScanRoot);
  const removeScanRoot = useAppStore((state) => state.removeScanRoot);
  const missingRoots = useAppStore((state) => state.missingRoots);
  const setMissingRoots = useAppStore((state) => state.setMissingRoots);
  const setError = useAppStore((state) => state.setError);
  const goTo = useAppStore((state) => state.goTo);

  const chooseLibraryRoot = useCallback(async () => {
    const result = await chooseFolder();
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
    const result = await chooseFolder();
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

  /**
   * Checks the remembered folders are still there.
   *
   * Folders are remembered between runs, so by the next launch one may have
   * been deleted, renamed, or be on a drive that is not plugged in. Saying so
   * is far better than a scan that quietly finds nothing.
   */
  useEffect(() => {
    void (async () => {
      const candidates = [...scanRoots, ...(libraryRoot === undefined ? [] : [libraryRoot])];
      if (candidates.length === 0) {
        setMissingRoots([]);
        return;
      }
      const checks = await Promise.all(
        candidates.map(async (root) => ({
          root,
          isThere: (await transport.listDirectories({ path: root })).ok,
        })),
      );
      setMissingRoots(checks.filter((check) => !check.isThere).map((check) => check.root));
    })();
  }, [libraryRoot, scanRoots, setMissingRoots, transport]);

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
    isPickerOpen,
    resolvePicker,
    missingRoots,
  };
}
