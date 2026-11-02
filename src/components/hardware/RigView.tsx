import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Box, LayoutGrid } from "lucide-react";
import type { HardwareState } from "@/types/hardware";
import { SegmentedControl, Skeleton } from "@/components/ui";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { webglAvailable } from "@/components/grid/grid3d/webgl";
import { RigGrid } from "./RigGrid";

const RigGrid3D = lazy(() => import("./rig3d/RigGrid3D"));

type View = "3d" | "plan";
const KEY = "gridnova-rig-view";

function readView(): View {
  try {
    return localStorage.getItem(KEY) === "plan" ? "plan" : "3d";
  } catch {
    return "3d";
  }
}

/** Falls back to the plan if the 3D view throws (e.g. WebGL lost). */
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
 * The Live grid while the data source is "Rig": the tabletop rig as a 3D mini campus (default)
 * or as a wiring plan. Same 3D / Plan switch as the campus grid; the choice is remembered here.
 */
export function RigView({ state, large }: { state: HardwareState; large?: boolean }) {
  const canGl = webglAvailable();
  const [view, setView] = useState<View>(() => (canGl ? readView() : "plan"));
  const narrow = useMediaQuery("(max-width: 639px)");
  const desktop = useMediaQuery("(min-width: 1024px)");
  const height = large ? (narrow ? 450 : desktop ? 600 : 520) : narrow ? 500 : 460;

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // ignore
    }
  };

  const plan = <RigGrid state={state} />;
  return (
    <div className="min-w-0">
      {canGl && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] text-fg-subtle">
            {view === "3d"
              ? narrow
                ? "The rig as a mini campus. Tap a part for details."
                : "The rig as a mini campus: each LED branch is a building. Drag to turn it, click a part for details."
              : "Wiring plan of the same rig."}
          </p>
          <SegmentedControl
            label="Rig view"
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
            <figcaption className="sr-only">3D model of the tabletop rig. The same values are in the plan view.</figcaption>
            <Suspense fallback={<div style={{ height }}><Skeleton className="h-full" /></div>}>
              <RigGrid3D state={state} height={height} />
            </Suspense>
          </figure>
          <p className="mt-3 text-[13px] text-fg-subtle">
            Measured by the rig: USB-level volts, milliamps and PWM duty, not campus kW. Labs = critical branch, Hostels = hostel, Library = library, Admin = extra.
          </p>
        </Fallback>
      ) : (
        plan
      )}
    </div>
  );
}
