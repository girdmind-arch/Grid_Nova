// hi
import { Timer } from "lucide-react";
import type { Incident, Lesson } from "@/types/agents";
import { Badge, IconTile } from "@/components/ui";
import { SCENARIOS } from "@/components/scenarios/scenarioMeta";
import { formatDate, formatNumber, formatTime } from "@/utils/format";
import { cn } from "@/utils/cn";

interface IncidentTimelineProps {
  incidents: Incident[];
  lessons: Lesson[];
  /** Ids of incidents created in this session (badged as new). */
  sessionIds: Set<string>;
}

function recoveryLabel(min: number) {
  if (min <= 0) return "No interruption";
  return `Recovered in ${formatNumber(min, 1)} min`;
}

/** Past incidents, newest first: cause, action, outcome and recovery time. */
export function IncidentTimeline({ incidents, lessons, sessionIds }: IncidentTimelineProps) {
  return (
    <ol className="relative">
      {incidents.map((inc, i) => {
        const meta = SCENARIOS[inc.type];
        const Icon = meta.icon;
        const lesson = lessons.find((l) => l.incidentId === inc.id);
        const fresh = sessionIds.has(inc.id);
        return (
          <li key={inc.id} className="relative flex gap-4 pb-6 last:pb-0">
            {i < incidents.length - 1 && <span aria-hidden className="absolute top-12 bottom-0 left-5 w-px bg-border" />}
            <IconTile icon={<Icon />} tone={meta.tone} size="md" className="relative" />
            <article
              className={cn(
                "min-w-0 flex-1 rounded-lg border bg-surface p-4 shadow-sm",
                fresh ? "border-ai/40" : "border-border",
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                <div className="min-w-0">
                  <p className="text-[13px] text-fg-subtle">
                    <time dateTime={inc.occurredAt}>
                      {formatDate(inc.occurredAt)} · <span className="font-mono tabular">{formatTime(inc.occurredAt)}</span>
                    </time>{" "}
                    · {inc.id}
                  </p>
                  <h3 className="mt-0.5 text-[15px] font-semibold text-fg">{inc.title}</h3>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {fresh && (
                    <Badge tone="ai" size="sm" dot>
                      This session
                    </Badge>
                  )}
                  <Badge tone={inc.recoveryMin <= 0 ? "success" : "neutral"} size="sm" icon={<Timer />}>
                    {recoveryLabel(inc.recoveryMin)}
                  </Badge>
                </div>
              </header>

              <dl className="mt-3 grid gap-2.5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="micro-label text-fg-subtle">Cause</dt>
                  <dd className="mt-0.5 text-fg-muted">{inc.cause}</dd>
                </div>
                <div>
                  <dt className="micro-label text-fg-subtle">Action</dt>
                  <dd className="mt-0.5 text-fg-muted">{inc.action}</dd>
                </div>
                <div>
                  <dt className="micro-label text-fg-subtle">Outcome</dt>
                  <dd className="mt-0.5 text-fg">{inc.outcome}</dd>
                </div>
              </dl>

              {lesson && (
                <p className="mt-3 rounded-md bg-ai/6 px-3 py-2 text-sm text-fg-muted">
                  <span className="font-semibold text-ai">Lesson learned: </span>
                  {lesson.note}
                </p>
              )}
            </article>
          </li>
        );
      })}
    </ol>
  );
}
