import { create } from "zustand";
import type { ControlMode, Environment } from "@/types/grid";

// Small shared app state. Anything that comes from the backend lives in
// services; this store only holds UI-level state shared across pages.

export const DEFAULT_GOAL = "Keep labs at full power and keep tonight's bill low.";

interface AppState {
  /** Who is in control: AI agents, safe fallback rules, or a human operator. */
  mode: ControlMode;
  setMode: (mode: ControlMode) => void;

  /** The operator's current goal, and how the Orchestrator understood it. */
  goal: string;
  goalInterpretation: string | null;
  setGoal: (goal: string, interpretation: string) => void;

  /** Clock and weather from the live backend (null on demo data). */
  environment: Environment | null;
  setEnvironment: (env: Environment | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: "ai",
  setMode: (mode) => set({ mode }),
  goal: DEFAULT_GOAL,
  goalInterpretation: null,
  setGoal: (goal, goalInterpretation) => set({ goal, goalInterpretation }),
  environment: null,
  // Called every few seconds: only notify the UI when something actually changed.
  setEnvironment: (environment) =>
    set((s) => (JSON.stringify(s.environment) === JSON.stringify(environment) ? s : { environment })),
}));
