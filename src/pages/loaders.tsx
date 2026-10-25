// Each app page is code-split and lazy-loaded, and warmed up in the background once the
// app is open. A page whose code is already here renders directly (no Suspense), which
// avoids React's ~300 ms "reveal after fallback" delay on the first visit.
import { lazy, type ComponentType } from "react";

interface Page {
  Component: ComponentType;
  preload: () => Promise<unknown>;
}

function page(load: () => Promise<{ default: ComponentType }>): Page {
  let ready: ComponentType | null = null;
  let started: Promise<unknown> | null = null;
  const preload = () =>
    (started ??= load().then((m) => {
      ready = m.default;
    }));
  const Lazy = lazy(async () => {
    await preload();
    return { default: ready! };
  });
  const Component: ComponentType = () => {
    const Ready = ready;
    return Ready ? <Ready /> : <Lazy />;
  };
  return { Component, preload };
}

export const ControlRoom = page(() => import("@/pages/ControlRoom"));
export const Agents = page(() => import("@/pages/Agents"));
export const Scenarios = page(() => import("@/pages/Scenarios"));
export const Maintenance = page(() => import("@/pages/Maintenance"));
export const Memory = page(() => import("@/pages/Memory"));
export const Results = page(() => import("@/pages/Results"));
export const Settings = page(() => import("@/pages/Settings"));

/** Fetches every page's code when the browser is idle. Returns a cleanup function. */
export function prefetchPages(): () => void {
  const loaders = [Agents, Scenarios, Maintenance, Memory, Results, Settings, ControlRoom].map((p) => p.preload);
  let cancelled = false;
  const run = () => {
    let i = 0;
    const next = () => {
      if (cancelled || i >= loaders.length) return;
      loaders[i++]().catch(() => {}).finally(() => setTimeout(next, 150));
    };
    next();
  };
  const idle = "requestIdleCallback" in window;
  const id = idle ? window.requestIdleCallback(run, { timeout: 2500 }) : window.setTimeout(run, 1200);
  return () => {
    cancelled = true;
    if (idle) window.cancelIdleCallback(id);
    else clearTimeout(id);
  };
}
