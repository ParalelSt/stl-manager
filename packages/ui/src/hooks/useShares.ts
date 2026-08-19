import { useCallback, useEffect, useState } from "react";
import { useHost } from "../host.js";
import { SCREEN, useAppStore } from "../store.js";
import type { ShareSummary } from "../transport.js";

/** A week, the default a share lasts. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Drives the sharing screen: making links, and revoking them. */
export function useShares() {
  const { transport } = useHost();
  const plan = useAppStore((state) => state.plan);
  const goTo = useAppStore((state) => state.goTo);

  const [shares, setShares] = useState<ShareSummary[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isWorking, setIsWorking] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const result = await transport.listShares();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShares(result.value);
  }, [transport]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (paths: string[], label: string, allowsUpload: boolean, expires: boolean) => {
      if (paths.length === 0) {
        setError("Choose at least one file to share.");
        return;
      }
      setIsWorking(true);
      setError(undefined);
      try {
        const result = await transport.createShare({
          paths,
          label,
          allowsUpload,
          expiresInMs: expires ? WEEK_MS : null,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setLastCreated(result.value.token);
        await refresh();
      } finally {
        setIsWorking(false);
      }
    },
    [refresh, transport],
  );

  const revoke = useCallback(
    async (id: string) => {
      await transport.revokeShare(id);
      setLastCreated(undefined);
      await refresh();
    },
    [refresh, transport],
  );

  const back = useCallback(() => {
    goTo(SCREEN.SETUP);
  }, [goTo]);

  return { shares, error, isWorking, lastCreated, plan, create, revoke, back, refresh };
}
