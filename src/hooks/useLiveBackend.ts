// hi
import { useEffect } from "react";
import { USE_MOCKS, getControl, getGridState } from "@/services";
import { useAppStore } from "@/store/appStore";
import { useScenarioStore } from "@/store/scenarioStore";

const PULSE_MS = 5000;

/**
 * With the live backend connected: restores the real mode and goal when the app
 * opens, then refreshes every few seconds so the grid, the agents' trace and the
 * top bar follow the backend. Pauses while the tab is hidden. Does nothing on demo data.
 */
export function useLiveBackend() {
  useEffect(() => {
    if (USE_MOCKS) return;
    const app = useAppStore.getState();

    getControl()
      .then((c) => {
        if (!c) return;
        app.setMode(c.mode);
        app.setGoal(c.goal, c.interpretation);
      })
      .catch(() => {
        /* the pages show their own connection errors */
      });

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      getGridState()
        .then((s) => {
          const store = useAppStore.getState();
          store.setEnvironment(s.environment ?? null);
          if (s.mode !== store.mode) store.setMode(s.mode);
        })
        .catch(() => useAppStore.getState().setEnvironment(null));
      void useScenarioStore.getState().pulse();
    };
    beat();
    const id = window.setInterval(beat, PULSE_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
}
