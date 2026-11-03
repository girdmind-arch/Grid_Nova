// hi
import { useState } from "react";
import { ChevronDown, FlaskConical, Loader2, RotateCcw } from "lucide-react";
import type { Results, WhatIfSettings } from "@/types/agents";
import { USE_MOCKS, ServiceError, runWhatIf } from "@/services";
import { Button, IconTile, toast } from "@/components/ui";
import { formatNumber } from "@/utils/format";

export const DEFAULT_SETTINGS: WhatIfSettings = { batteryKwh: 2000, solarPct: 100, peakRate: 9.7, tempOffsetC: 0 };

const SLIDERS: {
  key: keyof WhatIfSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
}[] = [
  { key: "batteryKwh", label: "Battery size", min: 0, max: 5000, step: 250, show: (v) => (v === 0 ? "No battery" : `${formatNumber(v / 1000, 2)} MWh`) },
  { key: "solarPct", label: "Solar array", min: 0, max: 250, step: 10, show: (v) => `${v}% of the current array (${formatNumber(Math.round(7.2 * v))} kW peak)` },
  { key: "peakRate", label: "Peak tariff", min: 5, max: 15, step: 0.05, show: (v) => `₹${v.toFixed(2)}/kWh` },
  { key: "tempOffsetC", label: "Weather", min: -6, max: 6, step: 1, show: (v) => (v === 0 ? "Typical May week" : `${v > 0 ? "+" : ""}${v}°C ${v > 0 ? "hotter" : "cooler"}`) },
];

const same = (a: WhatIfSettings, b: WhatIfSettings) => SLIDERS.every((s) => Math.abs(a[s.key] - b[s.key]) < 1e-6);

/** Change the campus and re-run the five-day simulation on the backend. */
export function WhatIfPanel({
  defaults = DEFAULT_SETTINGS,
  onResults,
}: {
  /** The real campus's settings (its state's peak rate). */
  defaults?: WhatIfSettings;
  onResults: (r: Results | null, s: WhatIfSettings) => void;
}) {
  const DEFAULT = defaults;
  const [draft, setDraft] = useState<WhatIfSettings>(DEFAULT);
  const [applied, setApplied] = useState<WhatIfSettings>(DEFAULT);
  const [running, setRunning] = useState(false);

  const run = async (settings: WhatIfSettings) => {
    setRunning(true);
    try {
      const r = await runWhatIf(settings);
      setApplied(settings);
      onResults(same(settings, DEFAULT) ? null : r, settings);
    } catch (e) {
      toast({ title: "Could not re-run the simulation.", description: e instanceof ServiceError ? e.message : "Try again.", tone: "warning" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <details className="group rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6 print:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 [&::-webkit-details-marker]:hidden">
        <IconTile icon={<FlaskConical />} tone="ai" size="sm" />
        <h2 className="text-base font-semibold text-fg">What if the campus were different?</h2>
        <ChevronDown aria-hidden strokeWidth={1.75} className="ml-auto size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-2 text-sm text-fg-muted">
        {USE_MOCKS
          ? "Needs the live backend: there, every change re-simulates all five days minute by minute."
          : "Change the campus, then re-run. The backend re-simulates all five days minute by minute, with and without the agents."}
      </p>

      <div className="mt-5 grid gap-x-8 gap-y-5 md:grid-cols-2">
        {SLIDERS.map((s) => (
          <label key={s.key} className="block">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="font-semibold text-fg">{s.label}</span>
              <span className="tabular text-fg-muted">{s.show(draft[s.key])}</span>
            </span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={draft[s.key]}
              disabled={USE_MOCKS || running}
              onChange={(e) => setDraft((d) => ({ ...d, [s.key]: Number(e.target.value) }))}
              className="mt-2 h-6 w-full cursor-pointer [accent-color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => void run(draft)} disabled={USE_MOCKS || running || same(draft, applied)}>
          {running ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          {running ? "Simulating 5 days…" : "Re-run simulation"}
        </Button>
        {!same(applied, DEFAULT) && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(DEFAULT);
              void run(DEFAULT);
            }}
            disabled={running}
          >
            <RotateCcw /> Back to the real campus
          </Button>
        )}
      </div>
    </details>
  );
}
