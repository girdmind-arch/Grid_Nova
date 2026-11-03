// hi
import { useSyncExternalStore } from "react";

/** True while the CSS media query matches, e.g. useMediaQuery("(min-width: 1024px)"). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Matches the `lg` breakpoint where the sidebar appears. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
