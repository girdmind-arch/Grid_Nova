// hi
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Play, SearchX } from "lucide-react";
import type { FaultType } from "@/types/grid";
import { getIncidentMemory } from "@/services";
import { useService } from "@/hooks/useService";
import { useScenarioStore } from "@/store/scenarioStore";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { IncidentTimeline } from "@/components/memory/IncidentTimeline";
import { SCENARIOS, SCENARIO_ORDER } from "@/components/scenarios/scenarioMeta";
import { cn } from "@/utils/cn";

type Filter = "all" | FaultType;

export default function Memory() {
  const memory = useService(getIncidentMemory);
  const sessionIncidents = useScenarioStore((s) => s.sessionIncidents);
  const sessionLessons = useScenarioStore((s) => s.sessionLessons);
  const [filter, setFilter] = useState<Filter>("all");

  // Past memory from the backend + what happened in this session, newest first.
  // A real backend also records this session's incidents, so keep one copy of each.
  const incidents = useMemo(
    () =>
      [
        ...sessionIncidents.filter((s) => !memory.data?.incidents.some((i) => i.id === s.id)),
        ...(memory.data?.incidents ?? []),
      ].sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      ),
    [sessionIncidents, memory.data],
  );
  const lessons = useMemo(
    () => [...sessionLessons.filter((s) => !memory.data?.lessons.some((l) => l.note === s.note)), ...(memory.data?.lessons ?? [])],
    [sessionLessons, memory.data],
  );
  const sessionIds = useMemo(() => new Set(sessionIncidents.map((i) => i.id)), [sessionIncidents]);

  const shown = filter === "all" ? incidents : incidents.filter((i) => i.type === filter);
  const timesApplied = lessons.reduce((n, l) => n + l.appliedCount, 0);
  const counts = (t: Filter) => (t === "all" ? incidents.length : incidents.filter((i) => i.type === t).length);

  return (
    <>
      <PageHeader title="Memory" description="Every incident GridNova has handled, and the lesson it took from each." />

      <Card variant="hero" padding="lg">
        <h2 className="max-w-2xl text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
          Every incident makes the next response better.
        </h2>
        {memory.data ? (
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
            {[
              { label: "Incidents remembered", value: incidents.length },
              { label: "Lessons learned", value: lessons.length },
              { label: "Times a lesson was reused", value: timesApplied },
            ].map((s) => (
              <div key={s.label}>
                <dt className="text-sm text-hero-text-muted">{s.label}</dt>
                <dd className="font-mono text-3xl font-semibold tabular">{s.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="mt-5 h-[68px]" />
        )}
        <Button asChild variant="onHero" size="lg" className="mt-6">
          <Link to="/app/scenarios">
            <Play /> Replay an incident
          </Link>
        </Button>
      </Card>

      {memory.status === "error" && !memory.data && <ErrorState className="mt-4" message={memory.error} onRetry={memory.retry} />}

      <div className="mt-8 max-w-4xl">
        <section aria-labelledby="timeline-title" className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="timeline-title" className="text-lg font-bold text-fg">
              Incident timeline
            </h2>
            <div role="group" aria-label="Filter incidents" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {(["all", ...SCENARIO_ORDER] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "h-9 shrink-0 rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap transition-colors pointer-coarse:h-11",
                    filter === f
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border bg-surface text-fg-muted hover:text-fg",
                  )}
                >
                  {f === "all" ? "All" : SCENARIOS[f].title} <span className="font-mono tabular opacity-80">{counts(f)}</span>
                </button>
              ))}
            </div>
          </div>

          {!memory.data && memory.status === "loading" && (
            <div className="space-y-4">
              <Skeleton className="h-40" />
              <Skeleton className="h-40" />
            </div>
          )}
          {memory.data && shown.length > 0 && <IncidentTimeline incidents={shown} lessons={lessons} sessionIds={sessionIds} />}
          {memory.data && shown.length === 0 && filter !== "all" && (
            <Card padding="none">
              <EmptyState
                icon={<SearchX />}
                title={`No ${SCENARIOS[filter].title.toLowerCase()} incidents yet`}
                description="Run this scenario and the agents will remember how they handled it."
                action={
                  <Button asChild variant="primary" size="sm">
                    <Link to="/app/scenarios">Go to Scenarios</Link>
                  </Button>
                }
              />
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
