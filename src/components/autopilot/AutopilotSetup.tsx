import { Check, CloudSun, Lock, ShieldCheck, Sparkles, Thermometer, Unplug, Wand2 } from "lucide-react";
import type { AutopilotRequest } from "@/types/autopilot";
import { Badge, Button, Card, IconTile, SegmentedControl } from "@/components/ui";
import { cn } from "@/utils/cn";
import { BUILDINGS, DEFAULT_REQUEST, HEAT_WORDS, hhmm, hoursText } from "./autopilotMeta";

const SLIDERS: {
  key: "heatSeverity" | "solarPct" | "outageStart" | "outageHours" | "startSoc";
  label: string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
}[] = [
  { key: "heatSeverity", label: "Heatwave", min: 0, max: 5, step: 1, show: (v) => (v ? `${HEAT_WORDS[v]} · cooling load +${v * 4}%` : "No heatwave") },
  { key: "solarPct", label: "Solar output", min: 0, max: 100, step: 5, show: (v) => `${v}% of a clear day (haze, dust, clouds)` },
  { key: "outageStart", label: "Outage expected at", min: 8, max: 20, step: 0.5, show: (v) => `${hhmm(v)} (±30 min)` },
  { key: "outageHours", label: "Expected to last", min: 0.5, max: 4, step: 0.5, show: (v) => `${hoursText(v)} (could run 35% longer)` },
  { key: "startSoc", label: "Battery when the warning comes", min: 30, max: 90, step: 5, show: (v) => `${v}%` },
];

/** Step 1: describe the coming emergency and choose what must stay powered. */
export function AutopilotSetup({
  value,
  onChange,
  onRun,
  busy,
}: {
  value: AutopilotRequest;
  onChange: (v: AutopilotRequest) => void;
  onRun: () => void;
  busy: boolean;
}) {
  const toggle = (id: string) =>
    onChange({ ...value, protect: value.protect.includes(id) ? value.protect.filter((p) => p !== id) : [...value.protect, id] });
  const isDefault = JSON.stringify({ ...value, protect: [...value.protect].sort() }) === JSON.stringify(DEFAULT_REQUEST);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5">
        <IconTile icon={<Sparkles />} tone="ai" size="sm" />
        <h2 className="text-base font-semibold text-fg">Resilience Autopilot</h2>
        <Badge size="sm" tone="neutral" className="ml-auto">Simulation</Badge>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-fg-muted">
        Plan for an outage before it happens. GridNova runs many versions of the emergency (different demand, solar, and when the grid fails and for how
        long), tests every plan against all of them in the digital twin, and recommends the cheapest, safest and best balanced plan for you to approve.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Badge tone="warning" icon={<Thermometer />}>Heatwave</Badge>
        <Badge tone="warning" icon={<CloudSun />}>Low solar</Badge>
        <Badge tone="danger" icon={<Unplug />}>Grid outage</Badge>
        {!isDefault && (
          <button type="button" onClick={() => onChange(DEFAULT_REQUEST)} className="ml-1 text-[13px] font-semibold text-accent hover:underline" disabled={busy}>
            <Wand2 aria-hidden className="mr-1 inline size-3.5" />
            Reset to the demo scenario
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
        {SLIDERS.map((s) => (
          <label key={s.key} className="block">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-semibold text-fg">{s.label}</span>
              <span className="tabular text-fg-muted">{s.show(value[s.key])}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={value[s.key]}
              disabled={busy}
              onChange={(e) => onChange({ ...value, [s.key]: Number(e.target.value) })}
              className="mt-2 h-6 w-full cursor-pointer [accent-color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        ))}
        <div>
          <span className="text-sm font-semibold text-fg">Versions of the emergency to test</span>
          <SegmentedControl
            label="Number of runs"
            value={String(value.runs) as "20" | "40" | "60"}
            onChange={(v) => onChange({ ...value, runs: Number(v) })}
            className="mt-2 w-full"
            options={[
              { value: "20", label: "20 runs" },
              { value: "40", label: "40 runs" },
              { value: "60", label: "60 runs" },
            ]}
          />
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className="flex items-center gap-2 text-sm font-semibold text-fg">
          <ShieldCheck aria-hidden className="size-4 text-success" /> What must stay at full power?
        </legend>
        <p className="mt-1 text-[13px] text-fg-muted">Labs are always protected. Every building you add leaves less battery for everyone else.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {BUILDINGS.map((b) => {
            const on = b.locked || value.protect.includes(b.id);
            return (
              <label
                key={b.id}
                className={cn(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors pointer-coarse:h-11",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                  on ? "border-success/40 bg-success/10 text-success" : "border-border bg-surface-sunken text-fg-muted hover:text-fg",
                  b.locked && "cursor-default",
                )}
              >
                <input type="checkbox" className="sr-only" checked={on} disabled={b.locked || busy} onChange={() => toggle(b.id)} />
                {b.locked ? <Lock aria-hidden className="size-3.5" /> : on ? <Check aria-hidden className="size-3.5" /> : null}
                {b.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={onRun} disabled={busy}>
          <Sparkles /> Compare plans
        </Button>
        <span className="text-[13px] text-fg-muted">
          About 300 plans × {value.runs} runs, tested in the digital twin. Nothing is sent to the grid or the rig.
        </span>
      </div>
    </Card>
  );
}
