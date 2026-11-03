// hi
import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { Box, LayoutGrid } from "lucide-react";
import type { GridState } from "@/types/grid";
import { SegmentedControl, Skeleton } from "@/components/ui";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/cn";
import { GridDiagram } from "./GridDiagram";
import { webglAvailable } from "./grid3d/webgl";

const Grid3D = lazy(() => import("./grid3d/Grid3D"));

type View = "3d" | "plan";
const KEY = "gridnova-grid-view";

function readView(): View {
  try {
    return localStorage.getItem(KEY) === "plan" ? "plan" : "3d";
  } catch {
    return "3d";
  }
}

/** Falls back to the 2D plan if the 3D view throws (e.g. WebGL lost). */
class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The live grid, as a 3D campus model (default) or the flat plan. The choice
 * is remembered on this device. Screen readers get the plan's text summary.
 */
export function GridView({ state, className, compactToggle, large }: { state: GridState; className?: string; compactToggle?: boolean; large?: boolean }) {
  const canGl = webglAvailable();
  const [view, setView] = useState<View>(() => (canGl ? readView() : "plan"));
  const narrow = useMediaQuery("(max-width: 639px)");
  const desktop = useMediaQuery("(min-width: 1024px)");
  // `large` is the Control Room's main view: taller, so buildings and labels have room.
  const height = large ? (narrow ? 450 : desktop ? 600 : 520) : narrow ? 500 : 460;

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // ignore
    }
  };

  const plan = <GridDiagram state={state} />;

  // The 3D engine is a big download: fetch it only once the grid is near the screen.
  const holder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = holder.current;
    if (!el || near) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near, view]);

  return (
    <div ref={holder} className={cn("min-w-0", className)}>
      {canGl && (
        <div className={cn("mb-3 flex items-center gap-3", compactToggle ? "justify-end" : "justify-between")}>
          {!compactToggle && (
            <p className="text-[13px] text-fg-subtle">
              {view === "3d" ? (narrow ? "Live 3D campus. Tap a building for details." : "Live 3D campus. Drag to turn it, click a building for details.") : "Flat plan of the same grid."}
            </p>
          )}
          <SegmentedControl
            label="Grid view"
            value={view}
            onChange={choose}
            options={[
              { value: "3d", label: "3D", icon: <Box aria-hidden /> },
              { value: "plan", label: "Plan", icon: <LayoutGrid aria-hidden /> },
            ]}
          />
        </div>
      )}
      {view === "3d" && canGl ? (
        <Fallback fallback={plan}>
          <figure className="m-0">
            <figcaption className="sr-only">
              3D model of the campus grid. The same values are in the plan view.
            </figcaption>
            {near ? (
              <Suspense fallback={<div style={{ height }}><Skeleton className="h-full" /></div>}>
                <Grid3D state={state} height={height} />
              </Suspense>
            ) : (
              <div style={{ height }}><Skeleton className="h-full" /></div>
            )}
          </figure>
        </Fallback>
      ) : (
        plan
      )}
    </div>
  );
}
