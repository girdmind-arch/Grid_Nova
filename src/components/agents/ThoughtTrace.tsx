// hi
import { BrainCircuit } from "lucide-react";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge, ErrorState, IconTile, Skeleton, ThinkingSteps } from "@/components/ui";
import { cn } from "@/utils/cn";
import { ThoughtTraceItem } from "./ThoughtTraceItem";

/** Live panel of agent decisions, newest first. The latest one starts expanded. */
export function ThoughtTrace({ className, limit }: { className?: string; limit?: number }) {
  const decisions = useScenarioStore((s) => s.decisions);
  const status = useScenarioStore((s) => s.traceStatus);
  const thinking = useScenarioStore((s) => s.thinking);
  const respond = useScenarioStore((s) => s.respond);
  const loadTrace = useScenarioStore((s) => s.loadTrace);
  const shown = limit ? decisions.slice(0, limit) : decisions;

  return (
    <section aria-labelledby="trace-title" className={cn("flex flex-col", className)}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <IconTile icon={<BrainCircuit />} tone="ai" size="sm" />
          <h2 id="trace-title" className="text-base font-semibold text-fg">
            Agent thought trace
          </h2>
        </div>
        {thinking ? (
          <Badge tone="ai" size="sm" dot pulse>
            Thinking
          </Badge>
        ) : (
          <Badge tone="success" size="sm" dot>
            Live
          </Badge>
        )}
      </header>

      <div aria-live="polite" className="space-y-3">
        {thinking && (
          <div className="rounded-lg border border-ai/40 bg-ai/6 p-3.5 shadow-glow-ai">
            <p className="micro-label mb-2.5 text-ai">Orchestrator is working</p>
            <ThinkingSteps stepMs={750} />
          </div>
        )}
        {status === "loading" && (
          <>
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </>
        )}
        {status === "error" && <ErrorState onRetry={() => void loadTrace()} />}
        {shown.map((d, i) => (
          <ThoughtTraceItem key={`${d.id}-${d.approval?.status ?? ""}`} decision={d} defaultOpen={i === 0} onRespond={respond} />
        ))}
      </div>
    </section>
  );
}
