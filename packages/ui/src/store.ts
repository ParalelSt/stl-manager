import {
  DEFAULT_SORTING_PROFILE,
  type PlanModel,
  type RunSummary,
  type SortingProfile,
} from "@stl-manager/core";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ProgressEvent } from "@stl-manager/contracts";
import type { AppliedRun } from "./host.js";
import {
  rememberedFrom,
  STORAGE_KEY,
  STORAGE_VERSION,
  toRemembered,
  type RememberedChoices,
} from "./persistence.js";

/** The screens the application moves between. */
export const SCREEN = {
  SETUP: "setup",
  SCAN: "scan",
  REVIEW: "review",
  APPLY: "apply",
  HISTORY: "history",
  LIBRARY: "library",
  PEERS: "peers",
  SHARES: "shares",
} as const;

/** One of the application's screens. */
export type Screen = (typeof SCREEN)[keyof typeof SCREEN];

interface AppState {
  screen: Screen;
  libraryRoot: string | undefined;
  scanRoots: string[];
  /** The library layout the next scan will build. */
  profile: SortingProfile;
  plan: PlanModel | undefined;
  progress: ProgressEvent | undefined;
  applied: AppliedRun | undefined;
  runs: RunSummary[];
  error: string | undefined;
  /** Remembered folders that are no longer on disk. */
  missingRoots: string[];

  goTo: (screen: Screen) => void;
  setLibraryRoot: (path: string) => void;
  setProfile: (profile: SortingProfile) => void;
  addScanRoot: (path: string) => void;
  removeScanRoot: (path: string) => void;
  setPlan: (plan: PlanModel | undefined) => void;
  setProgress: (progress: ProgressEvent | undefined) => void;
  setApplied: (applied: AppliedRun | undefined) => void;
  setRuns: (runs: RunSummary[]) => void;
  setError: (error: string | undefined) => void;
  setMissingRoots: (paths: string[]) => void;
}

/**
 * Navigation and configuration state for the whole application.
 *
 * Deliberately small. It holds where the user is, what they have chosen, and
 * the plan they are working on. Everything about how files are grouped and
 * where they will land lives in the engine, not here.
 *
 * The chosen folders and layout survive closing the application; nothing else
 * does. A
 * plan describes a moment rather than a choice, and restoring a half-finished
 * run against files that may have moved since would be worse than starting
 * cleanly.
 */
export const useAppStore = create<AppState>()(
  // The fourth type argument is the persisted shape, which is narrower than
  // the state: only the folders and the layout are written down.
  persist<AppState, [], [], RememberedChoices>(
    (set) => ({
      screen: SCREEN.SETUP,
      libraryRoot: undefined,
      scanRoots: [],
      profile: DEFAULT_SORTING_PROFILE,
      plan: undefined,
      progress: undefined,
      applied: undefined,
      runs: [],
      error: undefined,
      missingRoots: [],

      goTo: (screen) => set({ screen, error: undefined }),
      setLibraryRoot: (libraryRoot) => set({ libraryRoot }),
      setProfile: (profile) => set({ profile }),

      addScanRoot: (path) =>
        set((state) => {
          if (state.scanRoots.includes(path)) {
            return state;
          }
          return { scanRoots: [...state.scanRoots, path] };
        }),

      removeScanRoot: (path) =>
        set((state) => ({
          scanRoots: state.scanRoots.filter((root) => root !== path),
          missingRoots: state.missingRoots.filter((root) => root !== path),
        })),

      setPlan: (plan) => set({ plan }),
      setProgress: (progress) => set({ progress }),
      setApplied: (applied) => set({ applied }),
      setRuns: (runs) => set({ runs }),
      setError: (error) => set({ error }),
      setMissingRoots: (missingRoots) => set({ missingRoots }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only the choices are written down, and whatever comes back is
      // validated rather than trusted: storage outlives releases and a user
      // can edit it.
      partialize: rememberedFrom,
      merge: (stored, current) => ({ ...current, ...toRemembered(stored) }),
    },
  ),
);
