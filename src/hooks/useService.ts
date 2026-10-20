import { useCallback, useEffect, useState, type DependencyList } from "react";
import { ServiceError } from "@/services";

type State<T> =
  | { status: "loading"; data: T | undefined; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: T | undefined; error: string };

/**
 * Loads data from a service function and tracks loading / error state.
 * Errors are always human-readable (never raw stack traces).
 *
 *   const grid = useService(getGridState);
 *   if (grid.status === "error") return <ErrorState message={grid.error} onRetry={grid.retry} />;
 *
 * Pass `deps` to reload when something changes. While reloading, the previous
 * data stays available so the screen does not flash back to skeletons.
 */
// Last result per service function + deps, so revisiting a page shows its data at
// once and refreshes it quietly in the background (no skeleton flash).
const cache = new Map<unknown, Map<string, unknown>>();
const keyOf = (deps: DependencyList) => {
  try {
    return JSON.stringify(deps);
  } catch {
    return "";
  }
};

export function useService<T>(fn: () => Promise<T>, deps: DependencyList = []) {
  const [state, setState] = useState<State<T>>(() => {
    const hit = cache.get(fn)?.get(keyOf(deps)) as T | undefined;
    return hit !== undefined ? { status: "success", data: hit, error: null } : { status: "loading", data: undefined, error: null };
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ status: "loading", data: s.data, error: null }));
    fn()
      .then((data) => {
        if (!cache.has(fn)) cache.set(fn, new Map());
        const perFn = cache.get(fn)!;
        const key = keyOf(deps);
        perFn.delete(key);
        perFn.set(key, data);
        // Keep only the newest few results: live pages reload every few seconds with a new
        // version number, and an unbounded cache grew until phones ran out of memory.
        while (perFn.size > 4) perFn.delete(perFn.keys().next().value!);
        if (!cancelled) setState({ status: "success", data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof ServiceError ? err.message : "Something went wrong loading this. Please try again.";
        setState((s) => ({ status: "error", data: s.data, error: message }));
      });
    return () => {
      cancelled = true;
    };
  }, [fn, attempt, ...deps]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}
