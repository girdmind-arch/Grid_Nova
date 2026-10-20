import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import type { GridState } from "@/types/grid";
import { getGridState } from "@/services";
import { useService } from "@/hooks/useService";
import { useSimClock } from "@/hooks/useSimClock";
import { useAppStore } from "@/store/appStore";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge, Card, ErrorState, IconTile, Modal, PageHeader, Skeleton } from "@/components/ui";
import { GridLegend } from "@/components/grid/GridDiagram";
import { GridView } from "@/components/grid/GridView";
import { RigLiveCard } from "@/components/hardware/RigLiveCard";
import { ScenarioBanner } from "@/components/scenarios/ScenarioBanner";
import { SituationHero } from "@/components/control-room/SituationHero";
import { StatStrip } from "@/components/control-room/StatStrip";
import { LatestDecision } from "@/components/control-room/LatestDecision";
import { describeSituation } from "@/components/control-room/situation";
import { formatDate, greeting } from "@/utils/format";

function systemSummary(state: GridState | undefined) {
  if (!state) return "Reading the grid…";
  const total = state.zones.length;
  const powered = state.zones.filter((z) => z.status !== "faulted" && z.status !== "isolated").length;
  const reduced = state.zones.filter((z) => z.status === "reduced").length;
  if (powered < total) return `${powered} of ${total} zones powered. Agents are working on the rest.`;
  if (reduced) return `All ${total} zones powered, ${reduced} running reduced. Labs at full power.`;
  return `All ${total} zones powered. No faults.`;
}

export default function ControlRoom() {
  const now = useSimClock(15_000);
  const mode = useAppStore((s) => s.mode);
  const { gridVersion, decisions, phase, active, loadTrace } = useScenarioStore();
  const grid = useService(getGridState, [gridVersion]);
  const [gridOpen, setGridOpen] = useState(false);

  useEffect(() => {
    void loadTrace();
  }, [loadTrace]);

  // The hero talks about the scenario's decision while one runs, otherwise the standing plan.
  const latest = active ? decisions.find((d) => d.incidentId === active.incidentId) : decisions.find((d) => !d.incidentId);
  const situation = grid.data
    ? describeSituation(grid.data, latest, phase, now)
    : { headline: "Reading the grid…", detail: "" };

  // The card shows the decision the hero talks about, or the newest one.
  const shownDecision = (active && latest) || decisions[0];

  return (
    <>
      <PageHeader
        eyebrow={`Control Room · ${formatDate(now)}`}
        title={`${greeting(now)}, Operator`}
        description={systemSummary(grid.data)}
      />

      <ScenarioBanner className="mb-4" />

      <SituationHero headline={situation.headline} detail={situation.detail} mode={mode} onOpenGrid={() => setGridOpen(true)} />

      <div className="mt-4">
        {grid.status === "error" && !grid.data ? (
          <ErrorState message={grid.error} onRetry={grid.retry} />
        ) : grid.data ? (
          <StatStrip state={grid.data} />
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[122px]" />
            ))}
          </div>
        )}
      </div>

      <RigLiveCard className="mt-4 min-w-0" />

      <Card className="mt-4 min-w-0">
        <div className="mb-5 flex items-center gap-2.5">
          <IconTile icon={<Activity />} tone="accent" size="sm" />
          <h2 className="text-base font-semibold text-fg">Live grid</h2>
          <Badge tone="success" size="sm" dot pulse className="ml-auto">
            Live
          </Badge>
        </div>
        {grid.data ? <GridView state={grid.data} large /> : <Skeleton className="h-[450px] sm:h-[520px] lg:h-[600px]" />}
      </Card>

      <LatestDecision decision={shownDecision} className="mt-4 min-w-0" />

      <Modal open={gridOpen} onOpenChange={setGridOpen} title="Live grid" description={systemSummary(grid.data)} variant="full">
        <div className="mx-auto w-full max-w-5xl py-2">
          {grid.data && <GridView state={grid.data} large />}
          <GridLegend className="mt-6" />
        </div>
      </Modal>
    </>
  );
}
