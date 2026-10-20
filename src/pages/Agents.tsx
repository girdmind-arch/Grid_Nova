import { Link } from "react-router";
import { Pause, Play } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { setControlMode } from "@/services";
import { VIEW_ONLY_MESSAGE, canActNow } from "@/store/authStore";
import { toast } from "@/components/ui";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge, Button, Card, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { AgentCard } from "@/components/agents/AgentCard";
import { ThoughtTrace } from "@/components/agents/ThoughtTrace";
import { LearningPanel } from "@/components/agents/LearningPanel";
import { useLiveAgents } from "@/components/agents/useLiveAgents";
import { formatTime } from "@/utils/format";

export default function Agents() {
  const { agents, status, error, retry } = useLiveAgents();
  const phase = useScenarioStore((s) => s.phase);
  const decisions = useScenarioStore((s) => s.decisions);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const busy = agents?.filter((a) => a.status !== "idle" && a.status !== "paused") ?? [];
  const resume = async () => {
    if (!canActNow()) return void toast({ ...VIEW_ONLY_MESSAGE });
    try {
      const ack = await setControlMode("ai");
      setMode(ack.mode);
    } catch {
      toast({ title: "Could not resume AI Control.", description: "Nothing was changed. Try again.", tone: "warning" });
    }
  };

  const liveLine =
    mode !== "ai"
      ? "Some agents are paused while another control mode is on."
      : phase === "responding"
      ? `${busy.map((a) => a.name).join(", ")} are working on a scenario right now.`
      : phase === "awaiting-approval"
        ? "The Guardrail paused a high-impact plan. It is waiting for your approval."
        : decisions[0]
          ? `All agents are idle. Last decision at ${formatTime(decisions[0].startedAt)}.`
          : "All agents are idle.";

  return (
    <>
      <PageHeader title="Agents" description="The seven agents, what each one is doing right now, and what they have learned." />

      <Card variant="hero" padding="lg">
        <Badge tone="onHero" size="sm" dot pulse={phase !== "idle" && phase !== "stable"}>
          Live
        </Badge>
        <h2 className="mt-4 max-w-2xl text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
          Seven agents. One loop. Every decision explained.
        </h2>
        <p className="mt-2.5 max-w-xl text-[15px] text-hero-text-muted" aria-live="polite">
          {liveLine}
        </p>
        <Button asChild variant="onHero" size="lg" className="mt-6">
          <Link to="/app/scenarios">
            <Play /> Watch them handle a fault
          </Link>
        </Button>
      </Card>

      {mode !== "ai" && (
        <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-fg">
          <Pause aria-hidden className="size-4 shrink-0 text-warning" strokeWidth={1.75} />
          <p className="min-w-0 flex-1">
            {mode === "fallback"
              ? "Agents are paused: fixed safety rules are running the grid (Fallback mode). The setting is shared by everyone using this app."
              : "Agents are paused: Manual mode is on, so they only advise. The setting is shared by everyone using this app."}
          </p>
          <Button size="sm" onClick={resume}>Resume AI Control</Button>
        </div>
      )}

      {status === "error" && !agents && <ErrorState className="mt-4" message={error ?? undefined} onRetry={retry} />}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents
          ? agents.map((a) => <AgentCard key={a.id} agent={a} />)
          : status !== "error" && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64" />)}
      </div>

      <LearningPanel className="mt-6" />

      {/* Folded away: the full reasoning behind every decision so far. */}
      <details id="decisions" className="group mt-8 max-w-3xl rounded-lg border border-border bg-surface shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-base font-semibold text-fg [&::-webkit-details-marker]:hidden">
          Decision history
          <span className="text-sm font-medium text-fg-muted">
            {decisions.length} {decisions.length === 1 ? "decision" : "decisions"} · <span className="text-accent group-open:hidden">Show</span>
            <span className="hidden text-accent group-open:inline">Hide</span>
          </span>
        </summary>
        <div className="border-t border-border p-5">
          <ThoughtTrace />
        </div>
      </details>
    </>
  );
}
