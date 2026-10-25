import { useId, useState } from "react";
import { Play, Sparkles } from "lucide-react";
import type { FaultType } from "@/types/grid";
import type { ScenarioOutcome } from "@/types/agents";
import { Badge, Button, IconTile, SegmentedControl } from "@/components/ui";
import { formatNumber } from "@/utils/format";
import { cn } from "@/utils/cn";
import { SCENARIOS } from "./scenarioMeta";

const SEVERITY_WORDS = ["Mild", "Light", "Moderate", "Strong", "Severe"];
const DURATIONS = ["15", "30", "60"] as const;

interface ScenarioConfigCardProps {
  type: FaultType;
  onRun: (type: FaultType, severity: number, durationMin: number) => void;
  disabled?: boolean;
  running?: boolean;
  /** Earlier runs of this scenario, oldest first. */
  runs?: ScenarioOutcome[];
}

/** Large scenario card: what happens, how bad, how long, and a Run button. */
export function ScenarioConfigCard({ type, onRun, disabled, running, runs = [] }: ScenarioConfigCardProps) {
  const s = SCENARIOS[type];
  const Icon = s.icon;
  const [severity, setSeverity] = useState(3);
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>("30");
  const sliderId = useId();
  const best = runs.length ? Math.min(...runs.map((r) => r.recoveryMin)) : null;

  return (
    <article
      className={cn(
        "flex flex-col rounded-lg border bg-surface p-5 shadow-sm transition-[border-color,box-shadow] duration-200 sm:p-6",
        running ? "border-warning/60 shadow-md" : "border-border",
      )}
    >
      <header className="flex items-start gap-3.5">
        <IconTile icon={<Icon />} tone={s.tone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-fg">{s.title}</h3>
            {running && (
              <Badge tone="warning" size="sm" dot pulse>
                Running
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-[15px] text-fg-muted">{s.blurb}</p>
        </div>
      </header>

      <p className="mt-4 flex gap-2 rounded-md bg-surface-sunken px-3 py-2.5 text-sm text-fg-muted">
        <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0 text-ai" />
        <span>
          <span className="font-semibold text-fg">Plan preview: </span>
          {s.response}
        </span>
      </p>

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={sliderId} className="text-sm font-semibold text-fg">
            Severity
          </label>
          <span className="text-sm text-fg-muted">
            <span className="font-semibold text-fg">{SEVERITY_WORDS[severity - 1]}</span> · {s.severity[severity - 1]}
          </span>
        </div>
        <input
          id={sliderId}
          type="range"
          min={1}
          max={5}
          step={1}
          value={severity}
          disabled={disabled}
          onChange={(e) => setSeverity(Number(e.target.value))}
          aria-valuetext={`${SEVERITY_WORDS[severity - 1]}: ${s.severity[severity - 1]}`}
          className="mt-2 h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed"
        />
        <div aria-hidden className="-mt-2 flex justify-between text-xs text-fg-subtle">
          <span>Mild</span>
          <span>Severe</span>
        </div>
      </div>

      <div className="mt-4">
        <p aria-hidden className="mb-2 text-sm font-semibold text-fg">
          Duration
        </p>
        <SegmentedControl
          label="Duration"
          value={duration}
          onChange={setDuration}
          className="w-full"
          options={DURATIONS.map((d) => ({ value: d, label: `${d} min` }))}
        />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[13px] text-fg-muted">
          {best !== null ? (
            <>
              Best recovery: <span className="font-mono font-semibold text-success tabular">{formatNumber(best, 1)} min</span> over{" "}
              {runs.length} {runs.length === 1 ? "run" : "runs"}
            </>
          ) : (
            "Not run yet"
          )}
        </p>
        <Button onClick={() => onRun(type, severity, Number(duration))} disabled={disabled}>
          <Play /> Run scenario
        </Button>
      </div>
    </article>
  );
}
