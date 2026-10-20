import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BrainCircuit, Flag, GraduationCap, Printer, Timer } from "lucide-react";
import type { ScenarioOutcome } from "@/types/agents";
import type { FaultType } from "@/types/grid";
import { Badge, Button, Card, IconTile } from "@/components/ui";
import { formatNumber } from "@/utils/format";
import { printPage } from "@/utils/printPage";
import { cn } from "@/utils/cn";
import { SCENARIOS } from "./scenarioMeta";

/** Real seconds the whole no-AI race takes on screen. */
const RACE_MS = 5000;

/** Animated simulated-minute clock: 0 → target over the race. */
function useRace(baselineMin: number, key: string) {
  const [t, setT] = useState(0); // 0..1 of the race
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setT(1);
      return;
    }
    setT(0);
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / RACE_MS);
      setT(p);
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [key, baselineMin]);
  return t * baselineMin; // simulated minutes elapsed in the race
}

interface OutcomeCardProps {
  type: FaultType;
  /** Every run of this scenario this session, oldest first. */
  runs: ScenarioOutcome[];
  incidentId: string;
  className?: string;
}

/**
 * After a scenario: GridNova vs no AI as a race, and how recovery improved run
 * by run. Times are simulated minutes measured in the digital twin.
 */
export function OutcomeCard({ type, runs, incidentId, className }: OutcomeCardProps) {
  const last = runs.at(-1);
  const elapsed = useRace(last?.baselineMin ?? 0, incidentId);
  if (!last) return null;

  const meta = SCENARIOS[type];
  const faster = last.baselineMin > 0 ? Math.round((1 - last.recoveryMin / last.baselineMin) * 100) : 0;
  const lanes = [
    { key: "ai", name: "GridNova", min: last.recoveryMin, tone: "bg-success", icon: <BrainCircuit /> },
    { key: "none", name: "No AI (manual response)", min: last.baselineMin, tone: "bg-danger", icon: <Timer /> },
  ];
  const maxRun = Math.max(...runs.map((r) => r.baselineMin), 1);

  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center gap-2.5">
        <IconTile icon={<Flag />} tone="success" size="sm" />
        <h2 className="text-base font-semibold text-fg">Recovery race · {meta.title}</h2>
        <Badge tone="success" size="sm" className="ml-auto">
          {faster}% faster
        </Badge>
      </div>
      <p className="mt-1 text-[13px] text-fg-muted">
        The same fault replayed in the digital twin, with and without the agents. Simulated minutes.
      </p>

      <div className="mt-4 space-y-3">
        {lanes.map((l) => {
          const done = elapsed >= l.min;
          // Both bars share one scale (the no-AI time), so the gap is visible.
          const width = (Math.min(elapsed, l.min) / last.baselineMin) * 100;
          return (
            <div key={l.key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-1.5 font-semibold text-fg [&_svg]:size-4">
                  {l.icon}
                  {l.name}
                </span>
                <span className={cn("font-mono tabular", done ? "font-semibold text-fg" : "text-fg-muted")}>
                  {formatNumber(Math.min(elapsed, l.min), 1)} min{done && " · stable"}
                </span>
              </div>
              <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-surface-sunken">
                <div className={cn("h-full rounded-full", l.tone)} style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {last.breakdown && (
        <p className="mt-3 text-[13px] text-fg-muted">
          GridNova's {formatNumber(last.recoveryMin, 1)} min: detect {formatNumber(last.breakdown.detectMin, 1)} · plan{" "}
          {formatNumber(last.breakdown.analyseMin, 1)} ({last.breakdown.twinRuns} twin runs) · switch {formatNumber(last.breakdown.actMin, 1)}.
        </p>
      )}

      {runs.length > 1 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
            <GraduationCap aria-hidden className="size-4 text-ai" />
            The agents are learning
          </p>
          <ul className="mt-2.5 space-y-2">
            {runs.map((r) => (
              <li key={r.run} className="grid grid-cols-[52px_1fr_64px] items-center gap-2 text-[13px]">
                <span className="text-fg-muted">Run {r.run}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <motion.span
                    className="block h-full rounded-full bg-ai"
                    initial={{ width: 0 }}
                    animate={{ width: `${(r.recoveryMin / maxRun) * 100}%` }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  />
                </span>
                <span className="text-right font-mono font-semibold text-fg tabular">{formatNumber(r.recoveryMin, 1)} min</span>
              </li>
            ))}
          </ul>
          {last.lessonApplied && (
            <p className="mt-2.5 rounded-md bg-ai/6 px-3 py-2 text-[13px] text-fg-muted">
              <span className="font-semibold text-ai">Remembered: </span>
              {last.lessonApplied}
            </p>
          )}
        </div>
      )}

      {runs.length === 1 && last.lessonLearned && (
        <p className="mt-4 rounded-md bg-ai/6 px-3 py-2 text-[13px] text-fg-muted">
          <span className="font-semibold text-ai">Lesson saved to memory: </span>
          {last.lessonLearned} Replay: the Planner starts from this plan and needs fewer twin runs.
        </p>
      )}

      <div className="mt-4 flex justify-end print:hidden">
        <Button variant="ghost" size="sm" onClick={printPage}>
          <Printer /> Save incident report (PDF)
        </Button>
      </div>
    </Card>
  );
}
