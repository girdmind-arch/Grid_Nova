import { useEffect, useState } from "react";
import { useHardwareStore, watchHardware } from "@/store/hardwareStore";
import { OctagonX, Plug, ShieldCheck } from "lucide-react";
import type { DataSource, HardwareState, RigCommand } from "@/types/hardware";
import { RigReadings } from "@/components/hardware/RigReadings";
import {
  ServiceError, USE_MOCKS, armHardware, disarmHardware, emergencyStopHardware, resetEmergencyStop, setHardwareMode,
} from "@/services";
import { useCanAct } from "@/store/authStore";
import { Badge, Button, SegmentedControl, toast } from "@/components/ui";
import { formatTime } from "@/utils/format";

/** The rig's state, shared with the rest of the app (one poll every few seconds while anything shows it). */
export function useHardwareState() {
  const state = useHardwareStore((s) => s.state);
  const error = useHardwareStore((s) => s.error);
  const refresh = useHardwareStore((s) => s.refresh);
  const set = useHardwareStore((s) => s.set);
  useEffect(() => watchHardware(), []);
  return { state, error, refresh, set };
}

export const COMMAND_LABEL: Record<string, string> = {
  select_source: "Source",
  set_load: "Load",
  estop: "Emergency stop",
  clear_estop: "Clear emergency stop",
};

/** One line about a rig command, saying plainly whether it really happened on the table. */
export function commandProgress(c: RigCommand): { text: string; tone: "success" | "warning" | "neutral" | "danger" | "ai" } {
  if (c.physicallyPerformed) return { text: "Done on the rig", tone: "success" };
  switch (c.status) {
    case "awaiting_approval": return { text: "Waiting for approval", tone: "warning" };
    case "queued": return { text: "Queued", tone: "ai" };
    case "delivered": return { text: "Sent to device", tone: "ai" };
    case "applied": return c.verified === false ? { text: "Acknowledged, not seen in readings", tone: "danger" } : { text: "Acknowledged, confirming", tone: "ai" };
    case "rejected": return { text: "Device refused", tone: "danger" };
    case "failed": return { text: "Failed", tone: "danger" };
    case "expired": return { text: "Expired, not performed", tone: "neutral" };
    default: return { text: "Cancelled", tone: "neutral" };
  }
}

function describe(c: RigCommand) {
  const p = c.params;
  if (c.type === "select_source") return `Source → ${p.source === "powerbank" ? "power bank" : "adapter"}`;
  if (c.type === "set_load") return `${String(p.load)} branch → ${p.on ? "on" : "off"}`;
  return COMMAND_LABEL[c.type];
}

/** Settings → Hardware: simulation vs tabletop rig, arming, emergency stop and what the rig is doing. */
export function HardwareDemo() {
  const canAct = useCanAct();
  const { state, error, refresh, set } = useHardwareState();
  const [busy, setBusy] = useState(false);

  if (USE_MOCKS) {
    return (
      <p className="text-sm text-fg-muted">
        This copy runs on demo data, so there is no rig to connect. Open the live site and register an ESP32 device (see the README) to use the hardware demo.
      </p>
    );
  }
  if (!state) return <p className="text-sm text-fg-muted">{error ?? "Loading the hardware status…"}</p>;

  const run = async (fn: () => Promise<HardwareState>, ok: string) => {
    setBusy(true);
    try {
      set(await fn());
      toast({ title: ok, tone: "ai" });
    } catch (e) {
      toast({ title: "Not done.", description: e instanceof ServiceError ? e.message : "Try again.", tone: "warning" });
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const d = state.device;
  const online = d.status === "online";
  const hardwareOn = state.mode === "hardware-demo";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={hardwareOn ? "accent" : "neutral"} icon={<Plug />}>Data source: {hardwareOn ? "Hardware demo" : "Simulation"}</Badge>
        <Badge tone={online ? "success" : "neutral"} dot>{online ? "Rig online" : d.status === "never_seen" ? "Rig not seen yet" : "Rig offline"}</Badge>
        <Badge tone={state.armed ? "warning" : "neutral"} icon={<ShieldCheck />}>
          {state.armed ? `Armed${state.armedUntil ? ` until ${formatTime(state.armedUntil)}` : ""}` : "Not armed"}
        </Badge>
        {state.estop.active && <Badge tone="danger" icon={<OctagonX />}>Emergency stop</Badge>}
      </div>

      <p className="text-sm text-fg-muted">
        The rig is a small USB-level model of the campus: its readings are volts and milliamps, never campus kW. In hardware demo mode the rig drives the
        demo: unplug its wall adapter and the campus goes into a grid outage, the agents plan the response, and (when armed) the rig moves to the power
        bank at once while shedding waits for your approval. Plug it back in and the outage ends.
      </p>

      <SegmentedControl<DataSource>
        label="Data source"
        value={state.mode}
        onChange={(v) => canAct && void run(() => setHardwareMode(v), v === "simulation" ? "Simulation only" : "Hardware demo mode on")}
        className="w-full max-w-md"
        options={[{ value: "simulation", label: "Simulation" }, { value: "hardware-demo", label: "Hardware demo" }]}
      />
      {!state.configured && <p className="text-sm text-warning">No device key is set on the server, so hardware demo mode is unavailable.</p>}

      {hardwareOn && (
        <>
          {d.status !== "never_seen" && <RigReadings state={state} />}
          {d.warnings.map((w) => <p key={w} className="text-sm text-warning">{w}</p>)}

          {canAct ? (
            <div className="flex flex-wrap gap-2">
              {state.armed ? (
                <Button disabled={busy} onClick={() => void run(disarmHardware, "Disarmed. The rig is simulation-only again.")}>Disarm</Button>
              ) : (
                <Button variant="primary" disabled={busy || !online || state.estop.active} onClick={() => void run(() => armHardware(10), "Armed for 10 minutes")}>
                  Arm rig for 10 min
                </Button>
              )}
              {state.estop.active ? (
                <Button disabled={busy} onClick={() => void run(resetEmergencyStop, "Emergency stop reset. Loads stay off until commanded.")}>Reset emergency stop</Button>
              ) : (
                <Button variant="danger" disabled={busy} onClick={() => void run(emergencyStopHardware, "Emergency stop sent")}>
                  <OctagonX /> Emergency stop
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-fg-muted">View-only account: the rig can be watched but not armed.</p>
          )}
          <p className="text-xs text-fg-subtle">
            Arming lets the agents' actions reach the rig for a short time, including the automatic switch to the power bank when the adapter is unplugged.
            Shedding LED branches still waits for your approval.
          </p>
        </>
      )}

      {state.commands.length > 0 && (
        <section aria-labelledby="rig-cmds">
          <h3 id="rig-cmds" className="micro-label mb-2 text-fg-subtle">Latest commands</h3>
          <ul className="space-y-1.5">
            {state.commands.slice(0, 6).map((c) => {
              const p = commandProgress(c);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="font-medium text-fg">{describe(c)}</span>
                  <Badge size="sm" tone={p.tone}>{p.text}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {hardwareOn && state.events && state.events.length > 0 && (
        <section aria-labelledby="rig-events">
          <h3 id="rig-events" className="micro-label mb-2 text-fg-subtle">What the rig reported</h3>
          <ul className="space-y-1 text-sm">
            {state.events.slice(0, 6).map((e) => (
              <li key={e.at + e.text} className="flex gap-2">
                <span className="shrink-0 font-mono text-xs leading-5 text-fg-subtle tabular">{formatTime(e.at)}</span>
                <span className={e.level === "error" ? "text-danger" : e.level === "warning" ? "text-warning" : "text-fg-muted"}>{e.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="rig-caps">
        <h3 id="rig-caps" className="micro-label mb-2 text-fg-subtle">What the rig can and cannot show</h3>
        <ul className="space-y-1.5 text-sm text-fg-muted">
          {Object.entries(state.capabilities.scenarios).map(([k, v]) => (
            <li key={k}><span className="font-semibold text-fg">{k.replace("_", " ")}:</span> {v.summary}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
