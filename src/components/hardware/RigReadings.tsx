import type { HardwareState, RigReading } from "@/types/hardware";
import { Badge } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatNumber } from "@/utils/format";

// The tabletop rig's live readings. USB-level volts and milliamps, measured by the rig's own
// sensors: never campus kW. Shared by Settings → Hardware and the Control Room card.

/** "54 mA" below 1 A, "1.23 A" above: the rig's LED branches draw tens of milliamps. */
export const amps = (a: number) => (Math.abs(a) < 1 ? `${formatNumber(a * 1000)} mA` : `${a.toFixed(2)} A`);
export const watts = (w: number) => (w < 1 ? `${formatNumber(w * 1000)} mW` : `${w.toFixed(2)} W`);

function Tile({ label, children, note, tone }: { label: string; children: React.ReactNode; note?: string; tone?: "warning" | "danger" }) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-surface-sunken p-3", tone === "danger" ? "border-danger/40" : tone === "warning" ? "border-warning/40" : "border-border")}>
      <p className="micro-label text-fg-subtle">{label}</p>
      <div className="mt-1 text-sm font-semibold text-fg">{children}</div>
      {note && <p className="mt-0.5 text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function ReadingLine({ r }: { r: RigReading }) {
  return (
    <span className="font-mono tabular">
      {r.voltageV.toFixed(2)} V · {amps(r.currentA)} · {watts(r.powerW)}
    </span>
  );
}

export function RigReadings({ state, compact = false }: { state: HardwareState; compact?: boolean }) {
  const d = state.device;
  const out = d.readings.output ?? null;
  const single = d.sensorLayout === "output" || (out && !d.readings.adapter && !d.readings.battery);
  const supplyLost = out && state.limits?.supplyLostV !== undefined && out.voltageV < state.limits.supplyLostV;
  const source =
    d.source === "powerbank" ? "Power bank" : d.source === "adapter" ? "Wall adapter" : d.source === "none" ? "Switching…" : "Unknown";
  const relay = d.source === "powerbank" ? "relay on · NO contact" : d.source === "adapter" ? "relay off · NC contact" : "";
  const adapter = d.adapter;
  const model = d.model;
  const branches = state.capabilities.loads;

  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2")}>
      {single ? (
        <Tile
          label="Load rail (measured)"
          tone={supplyLost ? "danger" : undefined}
          note={out ? (supplyLost ? "No supply: the selected source is not delivering." : `${out.fresh ? "Measured just now" : "Last value (stale)"} · power is V × I`) : undefined}
        >
          {out ? <ReadingLine r={out} /> : <span className="font-normal text-fg-muted">No reading from the output sensor.</span>}
        </Tile>
      ) : (
        <>
          <Tile label="Adapter side">{d.readings.adapter ? <ReadingLine r={d.readings.adapter} /> : <span className="font-normal text-fg-muted">No reading.</span>}</Tile>
          <Tile label="Power-bank side">{d.readings.battery ? <ReadingLine r={d.readings.battery} /> : <span className="font-normal text-fg-muted">No reading.</span>}</Tile>
        </>
      )}

      <Tile label="Supply from" note={compact ? undefined : `${relay}${relay ? " · " : ""}power-bank charge: unknown`}>
        {source}
        {compact && relay && <span className="block text-xs font-normal text-fg-muted">{relay}</span>}
      </Tile>

      <Tile
        label="Wall adapter"
        tone={adapter?.present === false ? "warning" : undefined}
        note={adapter?.sensed ? `Adapter sense ${adapter.senseV !== null ? `${adapter.senseV.toFixed(2)} V` : "–"}` : "No adapter-sense divider fitted"}
      >
        {adapter?.present === true ? "Plugged in, supplying" : adapter?.present === false ? "Not supplying" : "Unknown"}
      </Tile>

      <Tile
        label="LED branches"
        note={
          model
            ? model.confident
              ? `Currents learned from ${formatNumber(model.samples)} readings`
              : "Learning each branch's current: switch branches to teach it"
            : undefined
        }
      >
        <span className="flex flex-wrap gap-1.5 font-normal">
          {branches.map((l) => {
            const on = d.loads[l.name];
            const ma = model?.branchMa[l.name];
            return (
              <Badge key={l.name} size="sm" tone={on ? "success" : "neutral"} dot>
                {l.name} {on ? "on" : "off"}
                {ma !== undefined && !compact ? ` · ${formatNumber(ma)} mA` : ""}
              </Badge>
            );
          })}
        </span>
      </Tile>

      {!compact && out && d.predictedCurrentA != null && model?.confident && (
        <Tile label="Model check" note="What the learned model expects for this branch combination, against the sensor.">
          <span className="font-mono tabular">
            expects {amps(d.predictedCurrentA)} · measured {amps(out.currentA)}
          </span>
        </Tile>
      )}
    </div>
  );
}
