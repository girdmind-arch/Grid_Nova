// hi
import { useCallback, useEffect, useState } from "react";

/**
 * Colour themes for the whole app (Settings → Appearance). The colours live
 * in src/styles/palettes.css; this hook only sets `data-palette` on <html>
 * and remembers the choice on this device. Keep the list and storage key in
 * sync with the no-flash script in index.html.
 */
export const PALETTES = [
  { id: "pine", name: "Pine", light: ["#15302b", "#22493f", "#0d6b5f"], dark: ["#112520", "#1b3f37", "#63d0b9"] },
  { id: "indigo", name: "Indigo", light: ["#22244c", "#3a3e84", "#4a4ead"], dark: ["#191a38", "#2e3170", "#a7aaf6"] },
  { id: "ocean", name: "Ocean", light: ["#0f2a40", "#1b5175", "#0d5e8c"], dark: ["#0c2032", "#173f5c", "#6cc0ee"] },
  { id: "forest", name: "Forest", light: ["#13281a", "#244e2d", "#2d6a2e"], dark: ["#0f2014", "#1f4427", "#8fd18a"] },
  { id: "plum", name: "Plum", light: ["#2c1424", "#56284a", "#873264"], dark: ["#221019", "#4a2140", "#eea2cb"] },
  { id: "graphite", name: "Graphite", light: ["#1b2027", "#3a434f", "#3c495b"], dark: ["#15181d", "#2f3640", "#b9c5d5"] },
] as const;

export type PaletteId = (typeof PALETTES)[number]["id"];

const STORAGE_KEY = "gridnova-palette";
const EVENT = "gridnova-palette-change";
const isPalette = (v: unknown): v is PaletteId => PALETTES.some((p) => p.id === v);

function read(): PaletteId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isPalette(saved)) return saved;
  } catch {
    // Storage blocked: use the default for this visit.
  }
  return "pine";
}

function apply(id: PaletteId) {
  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduceMotion && root.dataset.palette !== id) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 260);
  }
  if (id === "pine") delete root.dataset.palette;
  else root.dataset.palette = id;
  const bg = getComputedStyle(root).getPropertyValue("--theme-color").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

export function usePalette() {
  const [palette, setState] = useState<PaletteId>(read);

  useEffect(() => {
    // Other components / tabs changing the palette.
    const sync = () => setState(read());
    const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => apply(palette), [palette]);

  const setPalette = useCallback((id: PaletteId) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Ignore: still applies for this visit.
    }
    setState(id);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { palette, setPalette };
}
