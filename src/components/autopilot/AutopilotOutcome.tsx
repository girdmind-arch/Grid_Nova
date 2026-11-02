import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { BatteryMedium, CheckCircle2, Clock3, IndianRupee, Pause, Play, Scale, ShieldCheck, XCircle } from "lucide-react";
import type { AutopilotStudy, PlanKey, PlanMetrics } from "@/types/autopilot";
import { Badge, Button, Card, IconTile } from "@/components/ui";
import { AXIS_TICK, GRID_STROKE } from "@/components/results/chartParts";
import { formatInr, formatNumber } from "@/utils/format";
import { cn } from "@/utils/cn";
import { GuardrailList } from "./AutopilotCompare";
import { PLAN_META, hhmm } from "./autopilotMeta";

interface Row {
  label: string;
  icon: React.ReactNode;
  plan: string;
  base: string;
  better: boolean;
  delta: string;
  note: string;
}

function rows(p: PlanMetrics, b: PlanMetrics, runs: number): Row[] {
  const costDiff = p.costInr - b.costInr;
  return [
    {
      label: "Critical-load uptime",
      icon: <ShieldCheck />,
      plan: `${formatNumber(p.criticalUptimePct, 1)}%`,
      base: `${formatNumber(b.criticalUptimePct, 1)}%`,
      better: p.criticalUptimePct >= b.criticalUptimePct,
      delta: `untouched in ${p.protectedRuns}/${runs} runs vs ${b.protectedRuns}/${runs}`,
      note: "Share of the outage (and restoration) the protected buildings had full power.",
    },
    {
      label: "Recovery time",
      icon: <Clock3 />,
      plan: `${formatNumber(p.recoveryMin, 1)} min`,
      base: `${formatNumber(b.recoveryMin, 1)} min`,
      better: p.recoveryMin <= b.recoveryMin,
      delta: `${formatNumber(Math.max(0, b.recoveryMin - p.recoveryMin), 1)} min faster`,
      note: "From the grid returning to every building at full power (modelled switching times).",
    },
    {
      label: "Energy cost",
      icon: <IndianRupee />,
      plan: formatInr(p.costInr),
      base: formatInr(b.costInr),
      better: costDiff <= 0,
      delta: costDiff > 0 ? `${formatInr(costDiff)} more (pre-charging)` : costDiff < 0 ? `${formatInr(-costDiff)} less` : "same bill",
      note: "Grid energy bill over the window, before and after the outage.",
    },
    {
      label: "Battery reserve",
      icon: <BatteryMedium />,
      plan: `${formatNumber(p.reserveP10Pct, 0)}%`,
      base: `${formatNumber(b.reserveP10Pct, 0)}%`,
      better: p.reserveP10Pct >= b.reserveP10Pct,
      delta: `average ${formatNumber(p.reserveMeanPct, 0)}% vs ${formatNumber(b.reserveMeanPct, 0)}%`,
      note: "Charge left when the grid returns, in the worst 10% of runs.",
    },
    {
      label: "Fair sharing",
      icon: <Scale />,
      plan: `${p.fairness}/100`,
      base: `${b.fairness}/100`,
      better: p.fairness >= b.fairness,
      delta: `others got ${formatNumber(p.servedPct, 0)}% vs ${formatNumber(b.servedPct, 0)}% of their power`,
      note: "How evenly cuts were shared among unprotected buildings (100 = equal).",
    },
  ];
}

/** The typical run, minute by minute: battery and power delivered, plan vs baseline, with a play head. */
function Replay({ study, k }: { study: AutopilotStudy; k: PlanKey }) {
  const rp = study.replay;
  const n = rp.hours.length;
  // Open on the most telling moment: the baseline's protected buildings losing power, else mid-outage.
  const [i, setI] = useState(() => {
    const dark = rp.hours.findIndex((h, j) => h >= rp.outageFrom && h < rp.outageTo && !rp.plans.baseline[j].ok);
    if (dark >= 0) return Math.min(n - 1, dark + 2);
    const mid = (rp.outageFrom + rp.outageTo) / 2;
    return Math.max(0, rp.hours.findIndex((h) => h >= mid));
  });
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setI((x) => (x + 1 >= n ? (setPlaying(false), n - 1) : x + 1)), 90);
    return () => window.clearInterval(id);
  }, [playing, n]);

  const data = useMemo(
    () =>
      rp.hours.map((h, j) => ({
        h,
        demand: rp.demandKw[j],
        plan: rp.plans[k][j].servedKw,
        base: rp.plans.baseline[j].servedKw,
        planSoc: rp.plans[k][j].soc,
        baseSoc: rp.plans.baseline[j].soc,
      })),
    [rp, k],
  );
  const at = rp.hours[i];
  const p = rp.plans[k][i];
  const b = rp.plans.baseline[i];
  const outage = at >= rp.outageFrom && at < rp.outageTo;
  const ticks = rp.hours.filter((h) => Math.abs(h * 2 - Math.round(h * 2)) < 1e-6);

  const common = (
    <>
      <CartesianGrid vertical={false} stroke={GRID_STROKE} />
      <ReferenceArea x1={rp.outageFrom} x2={rp.outageTo} fill="var(--danger)" fillOpacity={0.08} />
      <XAxis type="number" dataKey="h" domain={[rp.hours[0], rp.hours[n - 1]]} ticks={ticks} tickFormatter={hhmm} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
      <ReferenceLine x={at} stroke="var(--text-subtle)" strokeDasharray="3 3" />
    </>
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-base font-semibold text-fg">Replay of a typical run</h3>
        <Badge size="sm" tone="neutral">Run {rp.run} of {study.stats.runs} · grid down {hhmm(rp.outageFrom)}–{hhmm(rp.outageTo)}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          onClick={() => {
            if (!playing && i >= n - 1) setI(0);
            setPlaying((x) => !x);
          }}
        >
          {playing ? <Pause /> : <Play />} {playing ? "Pause" : "Play"}
        </Button>
        <input
          type="range"
          min={0}
          max={n - 1}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          aria-label="Time in the replay"
          className="h-6 min-w-40 flex-1 cursor-pointer [accent-color:var(--accent)]"
        />
        <span className="font-mono text-sm tabular text-fg">{hhmm(at)}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-live="polite">
        {[
          { name: `GridNova · ${PLAN_META[k].label}`, pt: p },
          { name: "No-AI baseline", pt: b },
        ].map(({ name, pt }) => (
          <div key={name} className={cn("rounded-md border p-3 text-[13px]", outage && !pt.ok ? "border-danger/40 bg-danger/6" : "border-border bg-surface-sunken")}>
            <p className="font-semibold text-fg">{name}</p>
            <p className="mt-1 flex items-center gap-1.5 text-fg-muted">
              {pt.ok ? <CheckCircle2 aria-hidden className="size-4 text-success" /> : <XCircle aria-hidden className="size-4 text-danger" />}
              {outage ? (pt.ok ? "Protected buildings at full power" : "Protected buildings losing power") : at < rp.outageFrom ? "Grid up, preparing" : "Grid back"}
            </p>
            <p className="mt-0.5 font-mono tabular text-fg-muted">Battery {formatNumber(pt.soc, 0)}% · {formatNumber(pt.servedKw)} kW delivered</p>
          </div>
        ))}
      </div>

      <div aria-hidden className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-[13px] font-semibold text-fg-muted">Battery charge (%)</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
              {common}
              <YAxis domain={[0, 100]} ticks={[0, 20, 50, 90]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
              <ReferenceLine y={study.scenario.floorPct} stroke="var(--warning)" strokeDasharray="4 4" />
              <Line dataKey="baseSoc" stroke="var(--chart-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="planSoc" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="mb-1 text-[13px] font-semibold text-fg-muted">Power delivered to buildings (kW)</p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
              {common}
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(x: number) => formatNumber(x)} />
              <Area dataKey="demand" stroke="var(--text-subtle)" strokeDasharray="2 3" strokeWidth={1} fill="var(--text-subtle)" fillOpacity={0.18} isAnimationActive={false} />
              <Line dataKey="base" stroke="var(--chart-2)" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="plan" stroke="var(--chart-1)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-[var(--chart-1)]" /> GridNova</li>
        <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-[var(--chart-2)]" /> No-AI baseline</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-danger/15" /> Grid down</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-[3px] bg-[var(--text-subtle)] opacity-25" /> What buildings asked for</li>
        <li className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-warning" /> Battery floor</li>
      </ul>
    </Card>
  );
}

/** Step 3: the approved plan against the no-AI baseline, over every run. */
export function AutopilotOutcome({ study, k, onBack, onRestart }: { study: AutopilotStudy; k: PlanKey; onBack: () => void; onRestart: () => void }) {
  const plan = study.recommended[k];
  const base = study.baseline;
  const runs = study.stats.runs;
  const zones = plan.zones.filter((z) => !z.protected);
  const baseZone = new Map(base.zones.map((z) => [z.id, z.servedPct]));

  return (
    <div className="space-y-4">
      <Card variant="hero" padding="lg">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="onHero">Approved · {PLAN_META[k].label}</Badge>
          <Badge tone="onHero">Simulation · {runs} runs · not real hardware</Badge>
        </div>
        <h2 className="mt-3 max-w-3xl text-[24px] leading-tight font-bold tracking-tight sm:text-[28px]">
          Protected buildings kept full power in {plan.metrics.protectedRuns} of {runs} runs. Without GridNova: {base.metrics.protectedRuns} of {runs}.
        </h2>
        <p className="mt-3 max-w-3xl text-[15px] text-hero-text-muted">{plan.title}</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {rows(plan.metrics, base.metrics, runs).map((r) => (
          <div key={r.label} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <IconTile icon={r.icon} tone={r.better ? "success" : "warning"} size="sm" />
              <span className="micro-label text-fg-muted">{r.label}</span>
            </div>
            <p className="font-mono text-2xl font-semibold tabular text-fg">{r.plan}</p>
            <p className="text-[13px] text-fg-muted">
              No AI: <span className="font-mono tabular">{r.base}</span>
            </p>
            <p className={cn("text-[13px] font-medium", r.better ? "text-success" : "text-warning")}>{r.delta}</p>
            <p className="mt-auto text-[11px] text-fg-subtle">{r.note}</p>
          </div>
        ))}
      </div>

      <Replay study={study} k={k} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold text-fg">How the cuts were shared</h3>
          <p className="mt-1 text-[13px] text-fg-muted">Power each unprotected building got during the outage, averaged over all runs.</p>
          <ul className="mt-4 space-y-2.5">
            {zones.map((z) => {
              const b = baseZone.get(z.id) ?? 0;
              return (
                <li key={z.id} className="grid grid-cols-[7.5rem_1fr] items-center gap-3 text-[13px]">
                  <span className="truncate font-medium text-fg">{z.name}</span>
                  <span className="space-y-1">
                    <span className="flex items-center gap-2">
                      <span className="h-2 rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(1, z.servedPct)}%` }} />
                      <span className="font-mono tabular text-fg-muted">{z.servedPct}%</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="h-2 rounded-full bg-[var(--chart-2)]" style={{ width: `${Math.max(1, b)}%` }} />
                      <span className="font-mono tabular text-fg-subtle">{b}%</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12px] text-fg-subtle">Top bar GridNova, bottom bar no-AI baseline (which switches the hostels off and leaves the rest on until the battery runs out).</p>
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-fg">What was approved</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-fg-muted">
            {plan.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
          <h4 className="mt-4 text-sm font-semibold text-fg">Guardrail checks</h4>
          <div className="mt-2">
            <GuardrailList checks={plan.checks} />
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-[13px] font-semibold text-accent">How this was measured</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
              {study.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li>Seed {study.scenario.seed}: the same settings give the same runs.</li>
            </ul>
          </details>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button onClick={onBack}>Compare the plans again</Button>
        <Button variant="ghost" onClick={onRestart}>New scenario</Button>
      </div>
    </div>
  );
}
