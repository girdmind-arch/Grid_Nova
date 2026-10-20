import { Link } from "react-router";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  ChartSpline,
  GitCompareArrows,
  GraduationCap,
  ShieldCheck,
  TrendingDown,
  Zap,
} from "lucide-react";
import { getAgents, getResults } from "@/services";
import { useService } from "@/hooks/useService";
import { Card, IconTile, Skeleton } from "@/components/ui";
import { AGENT_LOOK } from "@/components/agents/agentMeta";
import { formatNumber } from "@/utils/format";
import { LandingSection } from "./LandingSection";

// ---------- How it works ----------

const STEPS = [
  { icon: ChartSpline, tone: "solar" as const, title: "Forecast", text: "A neural network trained on campus history predicts the next 12 hours, and keeps learning from the meters." },
  { icon: GitCompareArrows, tone: "ai" as const, title: "Plan and test", text: "Searches dozens of plans in a digital twin, including its own learned battery policy, before touching the grid." },
  { icon: ShieldCheck, tone: "success" as const, title: "Act safely", text: "Every action passes hard guardrails. Big moves wait for an operator's approval." },
  { icon: GraduationCap, tone: "accent" as const, title: "Explain and learn", text: "Says why with the real numbers, and remembers what worked so the next similar fault is solved faster." },
];

export function HowItWorksSection() {
  return (
    <LandingSection
      id="how-it-works"
      eyebrow="How it works"
      title="Four steps, every few minutes, all of them visible."
      description="The same loop runs for a normal evening peak and for a sudden fault."
    >
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <IconTile icon={<Icon />} tone={s.tone} />
                  <span className="font-mono text-sm font-semibold text-fg-subtle">0{i + 1}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-fg">{s.title}</h3>
                <p className="mt-1.5 text-[15px] text-fg-muted">{s.text}</p>
              </Card>
            </li>
          );
        })}
      </ol>
    </LandingSection>
  );
}

// ---------- Agents ----------

export function AgentsSection() {
  const agents = useService(getAgents);
  return (
    <LandingSection
      id="agents"
      eyebrow="The agents"
      title="Seven agents, one Orchestrator."
      description="Each agent has one job and a small set of tools. The Orchestrator brings their answers together and explains the decision."
    >
      {!agents.data ? (
        <Skeleton className="h-12" />
      ) : (
        <ul className="flex flex-wrap gap-2.5">
          {agents.data.map((a) => {
            const look = AGENT_LOOK[a.id];
            const Icon = look.icon;
            return (
              <li key={a.id} title={a.role} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pr-4 pl-1.5 text-[15px] font-semibold text-fg shadow-sm">
                <IconTile icon={<Icon />} tone={look.tone} size="sm" className="rounded-full" />
                {a.name}
              </li>
            );
          })}
        </ul>
      )}
      <Link to="/app/agents" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-hover">
        <BrainCircuit aria-hidden strokeWidth={1.75} className="size-4" /> Watch them think <ArrowRight aria-hidden strokeWidth={1.75} className="size-4" />
      </Link>
    </LandingSection>
  );
}

// ---------- Start here ----------

/** Three doors into the app, each with one live number and one action. */
export function StartHereSection() {
  const results = useService(getResults);
  const r = results.data;
  const doors = [
    {
      to: "/app",
      icon: Activity,
      tone: "success" as const,
      title: "Control Room",
      text: "See the campus grid right now and the agents' latest decision.",
      cta: "Open the Control Room",
    },
    {
      to: "/app/scenarios",
      icon: Zap,
      tone: "warning" as const,
      title: "Scenarios",
      text: "Break something on purpose and watch the agents respond.",
      cta: "Run a scenario",
    },
    {
      to: "/app/results",
      icon: TrendingDown,
      tone: "accent" as const,
      title: "Results",
      text: r
        ? `${formatNumber(r.headline.costSavedPct, 1)}% lower cost and ${formatNumber(r.headline.peakReducedPct, 1)}% lower evening peak than with no AI.`
        : "Compared with the same campus run without AI.",
      cta: "See the results",
    },
  ];

  return (
    <LandingSection id="start" eyebrow="Start here" title="Three places to look.">
      <ul className="grid gap-4 md:grid-cols-3">
        {doors.map((d) => {
          const Icon = d.icon;
          return (
            <li key={d.to}>
              <Link
                to={d.to}
                className="group flex h-full flex-col rounded-lg border border-border bg-surface p-5 shadow-sm transition-[border-color,box-shadow] hover:border-accent/50 hover:shadow-md sm:p-6"
              >
                <IconTile icon={<Icon />} tone={d.tone} />
                <h3 className="mt-4 text-lg font-semibold text-fg">{d.title}</h3>
                <p className="mt-1.5 flex-1 text-[15px] text-fg-muted">{d.text}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent group-hover:text-accent-hover">
                  {d.cta} <ArrowRight aria-hidden strokeWidth={1.75} className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </LandingSection>
  );
}
