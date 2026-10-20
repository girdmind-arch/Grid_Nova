import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BrainCircuit, Gauge, History, LineChart as LineIcon } from "lucide-react";
import type { LearningReport } from "@/types/agents";
import { getLearning } from "@/services";
import { useService } from "@/hooks/useService";
import { Badge, Card, ErrorState, IconTile, Skeleton } from "@/components/ui";
import { AXIS_TICK, GRID_STROKE } from "@/components/results/chartParts";
import { formatInr, formatNumber } from "@/utils/format";

const SCENARIO_NAMES: Record<string, string> = {
  cloud_cover: "Cloud cover",
  heatwave: "Heatwave",
  line_failure: "Line failure",
  grid_outage: "Grid outage",
};

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-sunken p-4">
      <p className="micro-label text-fg-muted">{label}</p>
      <p className="mt-1.5 font-mono text-xl font-semibold tabular text-fg">{value}</p>
      <p className="mt-1 text-[13px] leading-snug text-fg-muted">{note}</p>
    </div>
  );
}

function CurveTooltip({ active, payload, label }: { active?: boolean; label?: string | number; payload?: readonly { value?: unknown }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-md border border-glass-border bg-surface-solid/92 px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-fg">After {formatNumber(Number(label))} simulated days</p>
      <p className="text-fg-muted">Saves {formatInr(Number(payload[0].value))}/day vs an idle battery</p>
    </div>
  );
}

/** What the agents learned, measured on days and situations they had not seen. */
export function LearningPanel({ className }: { className?: string }) {
  const res = useService(getLearning);
  if (res.status === "error" && !res.data) return <ErrorState className={className} message={res.error} onRetry={res.retry} />;
  if (!res.data) return <Skeleton className={className ? `${className} h-96` : "h-96"} />;
  return <LearningBody data={res.data} className={className} />;
}

function LearningBody({ data, className }: { data: LearningReport; className?: string }) {
  const f = data.trained.forecaster;
  const p = data.trained.planner;
  const ev = p?.evaluation;
  const scen = data.trained.scenarios ?? [];
  const avg = (run: number) => {
    const xs = scen.map((s) => s.runs[run - 1]?.recoveryMin).filter((x): x is number => typeof x === "number");
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };

  return (
    <Card className={className} padding="lg">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile icon={<BrainCircuit />} tone="ai" size="sm" />
        <h2 className="text-lg font-semibold text-fg">What the agents learned</h2>
        <Badge tone="neutral" size="sm" className="ml-auto">
          Own models · no external AI
        </Badge>
      </div>
      <p className="mt-2 max-w-3xl text-[15px] text-fg-muted">
        Trained from scratch on simulated campus history, then scored on days they never saw. Every number below is measured, including where the
        learned policy still loses to the twin-sized plan.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Forecaster error"
          value={f ? `±${formatNumber(f.maeKw)} kW` : "Not trained"}
          note={f ? `Neural network, next 12 h. A typical-day profile is off by ±${formatNumber(f.baselineMaeKw.typicalDayProfile)} kW.` : "Using a typical-day profile."}
        />
        <Metric
          label="Learned battery policy"
          value={ev ? `${formatNumber(ev.learnedSavedVsNoAiPct, 1)}% cheaper` : "Not trained"}
          note={ev ? `than no AI over ${ev.days} unseen days (${formatInr(ev.avgNoAiInr - ev.avgLearnedInr)}/day).` : "Left out of the search."}
        />
        <Metric
          label="Twin-sized cap"
          value={ev ? `${formatNumber(ev.rulesSavedVsNoAiPct, 1)}% cheaper` : "–"}
          note={ev ? `The Planner runs both in the twin and keeps the better one. The learned policy is ${formatInr(Math.abs(ev.learnedVsRulesInr))}/day ${ev.learnedVsRulesInr >= 0 ? "ahead" : "behind"}.` : ""}
        />
        <Metric
          label="Critic memory"
          value={scen.length ? `${formatNumber(avg(1), 1)} → ${formatNumber(avg(2), 1)} min` : "–"}
          note="Average response, first run vs a repeat: a remembered plan needs fewer twin runs."
        />
      </div>

      {p && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <LineIcon aria-hidden className="size-4 text-ai" strokeWidth={1.75} /> Planner learning curve
            </h3>
            <p className="mt-1 text-[13px] text-fg-muted">
              Q-learning over {formatNumber(p.episodes)} simulated days. Early on it explores at random and loses money; it learns to save.
            </p>
            <div className="mt-3" role="img" aria-label={`Savings per day rose from ${formatInr(p.curve[0]?.avgSavedInr ?? 0)} to ${formatInr(p.curve.at(-1)?.avgSavedInr ?? 0)} during training.`}>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={p.curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
                  <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                  <XAxis dataKey="episode" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} tickFormatter={(n) => `${Math.round(n / 1000)}k`} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(n: number) => (n === 0 ? "₹0" : `${n < 0 ? "−" : ""}₹${formatNumber(Math.abs(n) / 1000)}K`)} />
                  <Tooltip content={CurveTooltip} />
                  <Line type="monotone" dataKey="avgSavedInr" stroke="var(--chart-5)" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <History aria-hidden className="size-4 text-ai" strokeWidth={1.75} /> Faster with experience
            </h3>
            <p className="mt-1 text-[13px] text-fg-muted">Each scenario run three times: response time, and the twin runs the Planner needed.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[300px] text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-fg-subtle">
                    <th className="py-1.5 pr-2 font-semibold">Scenario</th>
                    <th className="py-1.5 pr-2 font-semibold">Run 1</th>
                    <th className="py-1.5 pr-2 font-semibold">Run 2</th>
                    <th className="py-1.5 font-semibold">No AI</th>
                  </tr>
                </thead>
                <tbody>
                  {scen.map((s) => (
                    <tr key={s.type} className="border-t border-border">
                      <td className="py-2 pr-2 font-medium text-fg">{SCENARIO_NAMES[s.type] ?? s.type}</td>
                      {[0, 1].map((i) => (
                        <td key={i} className="py-2 pr-2 whitespace-nowrap">
                          <span className={i ? "font-mono tabular text-fg" : "font-mono tabular text-fg-muted"}>
                            {formatNumber(s.runs[i]?.recoveryMin ?? 0, 1)} min
                          </span>
                          <span className="block text-[12px] text-fg-subtle">{s.runs[i]?.twinRuns} twin runs</span>
                        </td>
                      ))}
                      <td className="py-2 font-mono whitespace-nowrap tabular text-fg-muted">{formatNumber(s.baselineMin, 0)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-[13px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5">
          <Gauge aria-hidden className="size-4" strokeWidth={1.75} />
          Live learning: {data.live.forecasterOnlineUpdates} forecast update{data.live.forecasterOnlineUpdates === 1 ? "" : "s"} from the meters
          {data.live.forecasterLiveMaeKw !== null && ` (live error ±${formatNumber(data.live.forecasterLiveMaeKw)} kW)`}
        </span>
        <span>Critic memory: {data.live.memories.length} plan{data.live.memories.length === 1 ? "" : "s"} remembered</span>
        {data.trained.trainedAt && <span>Trained {data.trained.trainedAt.slice(0, 10)} in {data.trained.trainingSeconds} s</span>}
      </div>
    </Card>
  );
}
