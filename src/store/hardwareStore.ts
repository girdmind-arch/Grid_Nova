import { create } from "zustand";
import type { HardwareState } from "@/types/hardware";
import { ServiceError, USE_MOCKS, getHardwareState } from "@/services";

const POLL_MS = 3000;

interface HardwareStore {
  state: HardwareState | null;
  error: string | null;
  refresh: () => Promise<void>;
  set: (s: HardwareState) => void;
}

/**
 * One shared copy of the tabletop rig's state, so the top bar, the Control Room and
 * Settings poll the backend once between them (not once each). Polls only while at
 * least one component uses it and the tab is visible.
 */
export const useHardwareStore = create<HardwareStore>((set) => ({
  state: null,
  error: null,
  refresh: async () => {
    try {
      set({ state: await getHardwareState(), error: null });
    } catch (e) {
      set({ error: e instanceof ServiceError ? e.message : "The hardware status could not be loaded." });
    }
  },
  set: (state) => set({ state, error: null }),
}));

let users = 0;
let timer: number | undefined;

/** Call from a component's effect: returns the cleanup. */
export function watchHardware(): () => void {
  users += 1;
  if (users === 1) {
    void useHardwareStore.getState().refresh();
    if (!USE_MOCKS) {
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void useHardwareStore.getState().refresh();
      }, POLL_MS);
    }
  }
  return () => {
    users -= 1;
    if (users === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}
