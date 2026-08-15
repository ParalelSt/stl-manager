import type { PlanModel, RunSummary } from "@stl-manager/core";
import { create } from "zustand";
import type { ProgressEvent } from "@shared/ipc.js";
import type { AppliedRun } from "./bridge.js";

/** The screens the application moves between. */
export const SCREEN = {
  SETUP: "setup",
  SCAN: "scan",
  REVIEW: "review",
  APPLY: "apply",
  HISTORY: "history",
} as const;

/** One of the application's screens. */
export type Screen = (typeof SCREEN)[keyof typeof SCREEN];

interface AppState {
  screen: Screen;
  libraryRoot: string | undefined;
  scanRoots: string[];
  plan: PlanModel | undefined;
  progress: ProgressEvent | undefined;
  applied: AppliedRun | undefined;
  runs: RunSummary[];
  error: string | undefined;

  goTo: (screen: Screen) => void;
  setLibraryRoot: (path: string) => void;
  addScanRoot: (path: string) => void;
  removeScanRoot: (path: string) => void;
  setPlan: (plan: PlanModel | undefined) => void;
  setProgress: (progress: ProgressEvent | undefined) => void;
  setApplied: (applied: AppliedRun | undefined) => void;
  setRuns: (runs: RunSummary[]) => void;
  setError: (error: string | undefined) => void;
}

/**
 * Navigation and configuration state for the whole application.
 *
 * Deliberately small. It holds where the user is, what they have chosen, and
 * the plan they are working on. Everything about how files are grouped and
 * where they will land lives in the engine, not here.
 */
export const useAppStore = create<AppState>((set) => ({
  screen: SCREEN.SETUP,
  libraryRoot: undefined,
  scanRoots: [],
  plan: undefined,
  progress: undefined,
  applied: undefined,
  runs: [],
  error: undefined,

  goTo: (screen) => set({ screen, error: undefined }),
  setLibraryRoot: (libraryRoot) => set({ libraryRoot }),

  addScanRoot: (path) =>
    set((state) => {
      if (state.scanRoots.includes(path)) {
        return state;
      }
      return { scanRoots: [...state.scanRoots, path] };
    }),

  removeScanRoot: (path) =>
    set((state) => ({ scanRoots: state.scanRoots.filter((root) => root !== path) })),

  setPlan: (plan) => set({ plan }),
  setProgress: (progress) => set({ progress }),
  setApplied: (applied) => set({ applied }),
  setRuns: (runs) => set({ runs }),
  setError: (error) => set({ error }),
}));
