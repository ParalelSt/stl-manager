import type { TreeFolder } from "@stl-manager/core";
import type { PeerSummary, PullOutcome } from "../transport.js";
import { useCallback, useEffect, useState } from "react";
import { useHost } from "../host.js";
import { SCREEN, useAppStore } from "../store.js";

/** Drives the peers screen: pairing machines, and forgetting them. */
export function usePeers() {
  const { transport } = useHost();
  const goTo = useAppStore((state) => state.goTo);

  const [peers, setPeers] = useState<PeerSummary[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isWorking, setIsWorking] = useState(false);

  const refresh = useCallback(async () => {
    const result = await transport.listPeers();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPeers(result.value);
  }, [transport]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pair = useCallback(
    async (baseUrl: string, shareToken: string, libraryRoot: string, label: string) => {
      setIsWorking(true);
      setError(undefined);
      try {
        const result = await transport.addPeer({
          baseUrl: baseUrl.trim(),
          shareToken: shareToken.trim(),
          libraryRoot: libraryRoot.trim(),
          ...(label.trim() === "" ? {} : { label: label.trim() }),
        });
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        await refresh();
        return true;
      } finally {
        setIsWorking(false);
      }
    },
    [refresh, transport],
  );

  const forget = useCallback(
    async (id: string) => {
      await transport.removePeer(id);
      await refresh();
    },
    [refresh, transport],
  );

  const back = useCallback(() => {
    goTo(SCREEN.SETUP);
  }, [goTo]);

  return { peers, error, isWorking, pair, forget, back, refresh };
}

/** Drives browsing one peer and pulling from it. */
export function usePeerLibrary(peerId: string | undefined) {
  const { transport } = useHost();
  const libraryRoot = useAppStore((state) => state.libraryRoot);

  const [root, setRoot] = useState<TreeFolder | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [outcome, setOutcome] = useState<PullOutcome | undefined>(undefined);

  useEffect(() => {
    if (peerId === undefined) {
      setRoot(undefined);
      return;
    }
    void (async () => {
      setIsLoading(true);
      const result = await transport.peerCatalogue(peerId);
      setIsLoading(false);
      if (!result.ok) {
        setError(result.error);
        setRoot(undefined);
        return;
      }
      setError(undefined);
      setRoot(result.value);
    })();
  }, [peerId, transport]);

  /**
   * Where pulled files land.
   *
   * Beside the library rather than inside it, because the scanner refuses to
   * scan the library and the whole point is to sort what arrives.
   */
  const stagingDir =
    libraryRoot === undefined
      ? undefined
      : `${libraryRoot.slice(0, libraryRoot.lastIndexOf("/"))}/_Incoming`;

  const pull = useCallback(
    async (paths: string[]) => {
      if (peerId === undefined || stagingDir === undefined) {
        return;
      }
      setIsLoading(true);
      setOutcome(undefined);
      try {
        const result = await transport.pullFromPeer({ peerId, stagingDir, paths });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOutcome(result.value);
      } finally {
        setIsLoading(false);
      }
    },
    [peerId, stagingDir, transport],
  );

  return { root, error, isLoading, outcome, pull, stagingDir };
}
