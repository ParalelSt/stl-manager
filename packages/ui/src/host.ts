import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Host } from "./transport.js";

export type { AppliedRun, Host, Transport } from "./transport.js";

const HostContext = createContext<Host | undefined>(undefined);

/** Supplies the interface with everything it needs from its surroundings. */
export function HostProvider({ host, children }: { host: Host; children: ReactNode }) {
  return createElement(HostContext.Provider, { value: host }, children);
}

/**
 * Reads the host the interface is running inside.
 *
 * @throws when used outside a HostProvider, which is otherwise a confusing
 *   failure deep inside an unrelated hook
 */
export function useHost(): Host {
  const host = useContext(HostContext);
  if (host === undefined) {
    throw new Error("useHost was called outside a HostProvider.");
  }
  return host;
}
