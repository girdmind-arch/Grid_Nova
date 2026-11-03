// hi
import { Cpu } from "lucide-react";
import { useScenarioStore } from "@/store/scenarioStore";
import { USE_MOCKS } from "@/services";
import { Badge } from "@/components/ui";
import { commandProgress, useHardwareState } from "@/components/settings/HardwareDemo";

const OUTCOME: Record<string, string> = {
  simulated_only: "Simulated only",
  software_only: "Software only",
  unsupported_on_hardware: "Simulated: the rig cannot do this",
  awaiting_approval: "Rig waiting for your approval",
  hardware_pending: "Sent to the rig",
};

/** Says whether the running scenario was physically performed on the tabletop rig or only simulated. */
export function RigStatus() {
  const hw = useScenarioStore((s) => s.hardware);
  if (USE_MOCKS || !hw) return null;
  return <RigStatusLive />;
}

function RigStatusLive() {
  const hw = useScenarioStore((s) => s.hardware)!;
  const { state } = useHardwareState();
  const mine = state?.commands.filter((c) => hw.commandIds.includes(c.id)) ?? [];
  const done = mine.length > 0 && mine.every((c) => c.physicallyPerformed);
  const label = done ? "Performed on the rig" : OUTCOME[hw.outcome] ?? "Simulated only";
  const tone = done ? "success" : hw.outcome === "hardware_pending" || hw.outcome === "awaiting_approval" ? "ai" : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-1.5" title={hw.reason}>
      <Badge tone={tone} icon={<Cpu />}>{label}</Badge>
      {mine.length > 0 && !done && <span className="text-xs text-fg-muted">{mine.map((c) => commandProgress(c).text).join(" · ")}</span>}
    </div>
  );
}
