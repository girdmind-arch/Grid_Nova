// hi
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

// Keep in sync with the no-flash script in index.html.
const STORAGE_KEY = "gridnova-theme";
const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#e9e6df", dark: "#0a0d0c" };
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // Storage blocked (private mode etc.): fall back to system.
  }
  return "system";
}

function writePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Ignore: the theme still applies for this visit.
  }
}

const resolve = (pref: ThemePreference): ResolvedTheme =>
  pref === "system" ? (darkQuery().matches ? "dark" : "light") : pref;

/** Applies the theme to <html>: data-theme, color-scheme and the theme-color meta. */
function applyTheme(theme: ResolvedTheme, animate: boolean) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate && !reduceMotion) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 260);
  }
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // The colour theme (data-palette) can tint the background, so read the live token.
  const bg = getComputedStyle(root).getPropertyValue("--theme-color").trim() || THEME_COLORS[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

interface ThemeContextValue {
  /** What the user picked. */
  preference: ThemePreference;
  /** What is actually showing (system resolved to light or dark). */
  theme: ResolvedTheme;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readPreference);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolve(readPreference()));

  // Apply whenever the preference changes.
  useEffect(() => {
    const next = resolve(preference);
    setTheme(next);
    applyTheme(next, true);
  }, [preference]);

  // In "system" mode, follow the OS live.
  useEffect(() => {
    if (preference !== "system") return;
    const mq = darkQuery();
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next, true);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  // Keep other open tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPref(readPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    writePreference(pref);
    setPref(pref);
  }, []);

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
