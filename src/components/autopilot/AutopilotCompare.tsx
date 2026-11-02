import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CheckCircle2, Layers, ShieldAlert, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import type { AutopilotStudy, CandidatePoint, PlanKey, PlanResult } from "@/types/autopilot";
import { Badge, Button, Card, IconTile } from "@/components/ui";
import { AXIS_TICK, GRID_STROKE } from "@/components/results/chartParts";
import { formatInr, formatNumber } from "@/utils/format";
import { cn } from "@/utils/cn";
import { PLAN_META, PLAN_ORDER } from "./autopilotMeta";

const inrK = (n: number) => `₹${formatNumber(n / 1000, 1)}K`;

type Point = { x: number; y: number; id: string; kind: "pass" | "fail" | "pick" | "baseline"; label?: string; runs?: number };

function PointTip({ active, payload, runs }: { active?: boolean; payload?: readonly { payload?: Point }[]; runs: number }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="glass-strong rounded-md border border-glass-border bg-surface-solid/92 px-3 py-2 text-[13px] shadow-md">
      <p className="font-semibold text-fg">{p.kind === "baseline" ? "No-AI baseline" : p.label ?? (p.kind === "fail" ? "Blocked by the Guardrail" : "Safe plan")}</p>
      <p className="text-fg-muted">Other buildings got {formatNumber(p.x, 1)}% of their power</p>
      <p className="text-fg-muted">Energy bill {formatInr(p.y)}</p>
      {p.runs !== undefined && <p className="text-fg-muted">Protected buildings untouched in {p.runs}/{runs} runs</p>}
    </div>
  );
}

/** A recommended plan on the chart: a ringed dot with its name. */
function PickMark(props: unknown) {
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: Point };
  if (cx === undefined || cy === undefined) return <g />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill="var(--ai)" fillOpacity={0.25} stroke="var(--ai)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={3.5} fill="var(--ai)" />
      <text x={cx < 90 ? cx - 9 : cx} y={cy - 14} textAnchor={cx < 90 ? "start" : "middle"} fontSize={12} fontWeight={700} fill="var(--text)" style={{ fontFamily: "var(--font-sans)" }}>
        {payload?.label}
      </text>
    </g>
  );
}

/** Every plan tested, as a cloud: power kept for unprotected buildings against cost. */
function PlanCloud({ study, reveal }: { study: AutopilotStudy; reveal: number }) {
  const picks = useMemo(() => {
    const out = new Map<string, string>();
    for (const k of PLAN_ORDER) {
      const id = study.recommended[k].id;
      out.set(id, out.has(id) ? `${out.get(id)} · ${PLAN_META[k].label}` : PLAN_META[k].label);
    }
    return out;
  }, [study]);
  const shown = study.candidates.slice(0, Math.round(study.candidates.length * reveal));
  const toPoint = (c: CandidatePoint): Point => ({ x: c.servedPct, y: c.costInr, id: c.id, kind: c.passes ? "pass" : "fail", runs: c.protectedRuns });
  const pass = shown.filter((c) => c.passes && !picks.has(c.id)).map(toPoint);
  const fail = shown.filter((c) => !c.passes).map(toPoint);
  const done = reveal >= 1;
  const chosen = done
    ? study.candidates.filter((c) => picks.has(c.id)).map((c) => ({ ...toPoint(c), kind: "pick" as const, label: picks.get(c.id) }))
    : [];
  const b = study.baseline.metrics;
  const base: Point[] = [{ x: b.servedPct, y: b.costInr, id: "baseline", kind: "baseline", runs: b.protectedRuns }];
  const ys = study.candidates.map((c) => c.costInr).concat(b.costInr);
  const lo = Math.floor(Math.min(...ys) / 1000) * 1000 - 1000;
  const hi = Math.ceil(Math.max(...ys) / 1000) * 1000 + 1000;
  const xs = study.candidates.map((c) => c.servedPct).concat(b.servedPct);
  const xMax = Math.min(100, Math.max(20, Math.ceil((Math.max(...xs) + 5) / 10) * 10));
  const xTicks = Array.from({ length: xMax / 10 + 1 }, (_, i) => i * 10).filter((t) => xMax <= 50 || t % 20 === 0);

  return (
    <div aria-hidden>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 12, right: 12, bottom: 8, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid stroke={GRID_STROKE} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, xMax]}
            ticks={xTicks}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            tickFormatter={(n: number) => `${n}%`}
          />
          <YAxis type="number" dataKey="y" domain={[lo, hi]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={inrK} width={60} />
          <ZAxis range={[44, 44]} />
          <Tooltip content={(p) => <PointTip {...(p as object)} runs={study.stats.runs} />} cursor={false} />
          <Scatter data={fail} fill="var(--chart-2)" fillOpacity={0.45} isAnimationActive={false} />
          <Scatter data={pass} fill="var(--chart-1)" fillOpacity={0.55} isAnimationActive={false} />
          <Scatter data={base} fill="var(--danger)" shape="diamond" isAnimationActive={false} />
          {done && <Scatter data={chosen} shape={PickMark} isAnimationActive={false} />}
        </ScatterChart>
      </ResponsiveContainer>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--chart-1)]" /> Passed the Guardrail</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[var(--chart-2)] opacity-60" /> Blocked</li>
        <li className="flex items-center gap-1.5"><span className="size-2.5 rotate-45 bg-danger" /> No-AI baseline</li>
        <li className="flex items-center gap-1.5"><span className="size-3 rounded-full border-2 border-ai bg-ai/25" /> Recommended</li>
        <li className="text-fg-subtle">Right = more power for unprotected buildings. Up = higher bill.</li>
      </ul>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-fg-muted">{label}</dt>
      <dd className="font-mono text-[15px] font-semibold tabular text-fg">{value}</dd>
      {note && <dd className="text-[11px] text-fg-subtle">{note}</dd>}
    </div>
  );
}

export function GuardrailList({ checks }: { checks: PlanResult["checks"] }) {
  return (
    <ul className="space-y-1.5">
      {checks.map((ch) => (
        <li key={ch.id} className="flex items-start gap-2 text-[13px]">
          {ch.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />}
          <span className={ch.ok ? "text-fg-muted" : "font-medium text-danger"}>
            <span className="font-mono text-[11px] text-fg-subtle">{ch.id}</span> {ch.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanCard({ k, plan, runs, chosen, onChoose }: { k: PlanKey; plan: PlanResult; runs: number; chosen: boolean; onChoose: () => void }) {
  const m = plan.metrics;
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer flex-col rounded-lg border bg-surface p-4 shadow-sm transition-colors",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        chosen ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong",
      )}
    >
      <input type="radio" name="autopilot-plan" className="sr-only" checked={chosen} onChange={onChoose} />
      <div className="flex items-center gap-2">
        <span className={cn("grid size-4 place-items-center rounded-full border-2", chosen ? "border-accent" : "border-border-strong")}>
          {chosen && <span className="size-2 rounded-full bg-accent" />}
        </span>
        <span className="text-[15px] font-bold text-fg">{PLAN_META[k].label}</span>
        {plan.passes ? (
          <Badge size="sm" tone="success" icon={<ShieldCheck />} className="ml-auto">Guardrail OK</Badge>
        ) : (
          <Badge size="sm" tone="danger" icon={<ShieldAlert />} className="ml-auto">Blocked</Badge>
        )}
      </div>
      <p className="mt-1 text-[13px] text-fg-muted">{PLAN_META[k].blurb}</p>
      <p className="mt-3 text-sm font-semibold text-fg">{plan.title}</p>
      {plan.sameAs && plan.sameAs.length > 0 && (
        <p className="mt-0.5 text-[12px] text-fg-subtle">Same plan as {plan.sameAs.map((s) => PLAN_META[s].label).join(" and ")}.</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Metric label="Protected untouched" value={`${m.protectedRuns}/${runs} runs`} />
        <Metric label="Critical uptime" value={`${formatNumber(m.criticalUptimePct, 1)}%`} note={`worst 10%: ${formatNumber(m.criticalUptimeP10, 1)}%`} />
        <Metric label="Others get" value={`${formatNumber(m.servedPct, 1)}%`} note="of the power they ask for" />
        <Metric label="Energy bill" value={formatInr(m.costInr)} />
        <Metric label="Battery left" value={`${formatNumber(m.reserveP10Pct, 0)}%`} note="worst 10% of runs" />
        <Metric label="Fair sharing" value={`${m.fairness}/100`} />
      </dl>
      <details className="group mt-3">
        <summary className="cursor-pointer text-[13px] font-semibold text-accent">Actions and guardrail checks</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-fg-muted">
          {plan.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
        <div className="mt-3">
          <GuardrailList checks={plan.checks} />
        </div>
      </details>
    </label>
  );
}

/** Step 2: watch the plans being compared, pick one, approve it. */
export function AutopilotCompare({
  study,
  chosen,
  onChoose,
  onApprove,
  onBack,
}: {
  study: AutopilotStudy;
  chosen: PlanKey;
  onChoose: (k: PlanKey) => void;
  onApprove: () => void;
  onBack: () => void;
}) {
  // Reveal the cloud of plans over ~2 s, so the comparison can be watched (the study itself is already done).
  const [reveal, setReveal] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReveal(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const r = Math.min(1, (now - t0) / 2200);
      setReveal(r);
      if (r < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [study.studyId]);
  const done = reveal >= 1;
  const s = study.stats;
  const v = study.variants;
  const testedRuns = Math.round(s.twinRuns * reveal);
  const plan = study.recommended[chosen];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2.5">
          <IconTile icon={<Layers />} tone="ai" size="sm" />
          <h2 className="text-base font-semibold text-fg">{done ? "Plans compared" : "Comparing plans…"}</h2>
          <Badge size="sm" tone="neutral" className="ml-auto">Simulation · {s.runs} runs</Badge>
        </div>
        <p className="mt-2 text-sm text-fg-muted" aria-live="polite">
          <span className="font-mono tabular text-fg">{formatNumber(testedRuns)}</span> of {formatNumber(s.twinRuns)} twin runs ({s.plans} plans + the
          no-AI baseline, each against {s.runs} versions of the emergency)
          {done && <> · {s.feasible} plans passed the Guardrail · computed in {formatNumber(s.elapsedMs / 1000, 1)} s</>}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
          <Badge size="sm" tone="neutral">Demand {v.demandPct[0]}–{v.demandPct[1]}%</Badge>
          <Badge size="sm" tone="neutral">Solar {v.solarPct[0]}–{v.solarPct[1]}% of clear sky</Badge>
          <Badge size="sm" tone="neutral">Grid fails {v.outageStart[0]}–{v.outageStart[1]}</Badge>
          <Badge size="sm" tone="neutral">Lasts {v.outageHours[0]}–{v.outageHours[1]} h</Badge>
          <Badge size="sm" tone="neutral">Battery {v.startSoc[0]}–{v.startSoc[1]}%</Badge>
        </div>
        <div className="mt-4">
          <PlanCloud study={study} reveal={reveal} />
        </div>
      </Card>

      {done && (
        <>
          {!study.anyFeasible && (
            <Card className="border-danger/40">
              <p className="flex items-center gap-2 text-sm font-semibold text-danger">
                <ShieldAlert aria-hidden className="size-4" /> No plan keeps everything you protected powered in 95% of runs.
              </p>
              <p className="mt-1 text-sm text-fg-muted">
                The battery cannot carry that much through a long outage. The Guardrail blocks these plans: protect fewer buildings, or start with more charge.
              </p>
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {PLAN_ORDER.map((k) => (
              <PlanCard key={k} k={k} plan={study.recommended[k]} runs={s.runs} chosen={chosen === k} onChoose={() => onChoose(k)} />
            ))}
          </div>
          <Card>
            <div className="flex flex-wrap items-center gap-2.5">
              <IconTile icon={plan.passes ? <ShieldCheck /> : <ShieldAlert />} tone={plan.passes ? "success" : "danger"} size="sm" />
              <h3 className="text-base font-semibold text-fg">Guardrail review · {PLAN_META[chosen].label}</h3>
            </div>
            <div className="mt-3">
              <GuardrailList checks={plan.checks} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={onApprove} disabled={!plan.passes}>
                <Sparkles /> Approve {PLAN_META[chosen].label.toLowerCase()} plan
              </Button>
              <Button variant="ghost" onClick={onBack}>Change the scenario</Button>
              {!plan.passes && <span className="text-[13px] text-danger">The Guardrail blocked this plan, so it cannot be approved.</span>}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
