import { Link } from "react-router";
import { Cpu, OctagonX, ShieldCheck } from "lucide-react";
import { USE_MOCKS } from "@/services";
import { useHardwareState } from "@/components/settings/HardwareDemo";
import { Badge, Card, IconTile } from "@/components/ui";
import { formatTime } from "@/utils/format";
import { RigReadings } from "./RigReadings";

/** Control Room: the tabletop rig's live readings, shown while hardware demo mode is on. */
export function RigLiveCard({ className }: { className?: string }) {
  if (USE_MOCKS) return null;
  return <Live className={className} />;
}

function Live({ className }: { className?: string }) {
  const { state } = useHardwareState();
  if (!state || state.mode !== "hardware-demo") return null;
  const d = state.device;
  const online = d.status === "online";
  const latest = state.events?.[0];
  return (
    <Card className={className}>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <IconTile icon={<Cpu />} tone="ai" size="sm" />
        <h2 className="text-base font-semibold text-fg">Tabletop rig</h2>
        <span className="text-[13px] text-fg-muted">measured · USB volts and milliamps, not campus kW</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Badge size="sm" tone={online ? "success" : "neutral"} dot pulse={online}>
            {online ? `Online · ${d.ageS !== null ? `${Math.round(d.ageS)} s ago` : "now"}` : d.status === "never_seen" ? "Not seen yet" : "Offline"}
          </Badge>
          <Badge size="sm" tone={state.armed ? "warning" : "neutral"} icon={<ShieldCheck />}>
            {state.armed ? `Armed${state.armedUntil ? ` · ${formatTime(state.armedUntil)}` : ""}` : "Not armed"}
          </Badge>
          {state.estop.active && <Badge size="sm" tone="danger" icon={<OctagonX />}>Emergency stop</Badge>}
        </span>
      </div>
      {d.status === "never_seen" ? (
        <p className="text-sm text-fg-muted">Waiting for the ESP32's first reading. Check its Wi-Fi and device key.</p>
      ) : (
        <RigReadings state={state} compact />
      )}
      {d.warnings.slice(0, 2).map((w) => (
        <p key={w} className="mt-3 text-sm text-warning">{w}</p>
      ))}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-fg-muted">
        <span>{latest ? `${formatTime(latest.at)} · ${latest.text}` : "Unplug the rig's wall adapter to start a grid outage on the campus."}</span>
        <Link to="/app/settings#hardware" className="font-semibold text-accent hover:underline">Arm, stop and details</Link>
      </div>
    </Card>
  );
}
