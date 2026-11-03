// hi
import { useEffect, useRef, useState } from "react";
import type { GridState } from "@/types/grid";
import { GridScene } from "./GridScene";
import { NodeCard } from "./NodeCard";

/**
 * React wrapper for the three.js campus grid. Creates the scene once, feeds it
 * each new GridState, follows the theme, and only animates while on screen.
 * Click a building to fly to it and see its live numbers. Loaded lazily
 * (three.js is large), see GridView.
 */
export default function Grid3D({ state, height }: { state: GridState; height: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GridScene | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new GridScene(host);
    sceneRef.current = scene;
    scene.onPick = setPicked;

    const ro = new ResizeObserver(([entry]) => scene.resize(entry.contentRect.width, entry.contentRect.height));
    ro.observe(host);

    // Animate only while visible and the tab is in front.
    let onScreen = false;
    const sync = () => (onScreen && !document.hidden ? scene.start() : scene.stop());
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(host);
    document.addEventListener("visibilitychange", sync);

    const mo = new MutationObserver(() => scene.applyPalette());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });

    return () => {
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", sync);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.update(state);
  }, [state]);

  return (
    <div ref={hostRef} className="grid3d relative w-full overflow-hidden rounded-lg" style={{ height }}>
      {picked && <NodeCard id={picked} state={state} onClose={() => sceneRef.current?.select(null)} />}
    </div>
  );
}
