import type { TreeFolder } from "@stl-manager/core";
import { useCallback, useEffect, useState } from "react";
import { useHost } from "../host.js";
import { SCREEN, useAppStore } from "../store.js";

/**
 * Reads the library as it really is on disk.
 *
 * Used after a run, when the question is what actually happened rather than
 * what was planned. The tree is read-only here: rearranging the real library
 * would need its own file operation and its own undo.
 */
export function useLibrary() {
  const { transport } = useHost();
  const libraryRoot = useAppStore((state) => state.libraryRoot);
  const goTo = useAppStore((state) => state.goTo);

  const [root, setRoot] = useState<TreeFolder | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (libraryRoot === undefined) {
      return;
    }
    setIsLoading(true);
    try {
      const result = await transport.readLibrary({ libraryRoot });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(undefined);
      setRoot(result.value);
    } finally {
      setIsLoading(false);
    }
  }, [libraryRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reveal = useCallback((path: string) => {
    void transport.revealInFinder({ path });
  }, []);

  const back = useCallback(() => {
    goTo(SCREEN.HISTORY);
  }, [goTo]);

  return { libraryRoot, root, error, isLoading, refresh, reveal, back };
}
