// hi
import { useState } from "react";
import { Link } from "react-router";
import { ArrowRight, BrainCircuit, MessageCircleQuestion } from "lucide-react";
import type { Decision } from "@/types/agents";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge, Button, Card, IconTile, Modal, Skeleton, ThinkingSteps } from "@/components/ui";
import { ThoughtTraceItem } from "@/components/agents/ThoughtTraceItem";
import { formatTime } from "@/utils/format";

/** The agents' latest decision in two lines; the full reasoning opens on demand. */
export function LatestDecision({ decision, className }: { decision?: Decision; className?: string }) {
  const thinking = useScenarioStore((s) => s.thinking);
  const respond = useScenarioStore((s) => s.respond);
  const [open, setOpen] = useState(false);
  const pending = decision?.approval?.status === "pending";
  const plan = decision?.plans.find((p) => p.id === decision.chosenPlanId);

  return (
    <Card className={className}>
      <div className="flex items-center gap-2.5">
        <IconTile icon={<BrainCircuit />} tone="ai" size="sm" />
        <h2 className="text-base font-semibold text-fg">Latest decision</h2>
        {thinking ? (
          <Badge tone="ai" size="sm" dot pulse className="ml-auto">
            Thinking
          </Badge>
        ) : pending ? (
          <Badge tone="warning" size="sm" dot pulse className="ml-auto">
            Needs you
          </Badge>
        ) : null}
      </div>

      {thinking ? (
        <div className="mt-4 rounded-md bg-ai/6 p-3.5">
          <ThinkingSteps stepMs={750} />
        </div>
      ) : !decision ? (
        <Skeleton className="mt-4 h-24" />
      ) : (
        <>
          <p className="mt-4 font-mono text-xs text-fg-subtle">{formatTime(decision.startedAt)}</p>
          <p className="mt-1 max-w-3xl text-[17px] leading-snug font-semibold text-fg">{plan ? `Plan ${plan.id}: ${plan.title}` : decision.title}</p>
          <p className="mt-1.5 max-w-3xl text-sm text-fg-muted">{pending ? decision.approval?.request : decision.chosenReason}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button variant={pending ? "primary" : "secondary"} size="sm" onClick={() => setOpen(true)}>
              <MessageCircleQuestion /> {pending ? "Review and decide" : "Why?"}
            </Button>
            <Link to="/app/agents#decisions" className="inline-flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent-hover">
              All decisions <ArrowRight aria-hidden strokeWidth={1.75} className="size-4" />
            </Link>
          </div>
        </>
      )}

      {decision && (
        <Modal open={open} onOpenChange={setOpen} title={decision.title} description={decision.trigger}>
          <ThoughtTraceItem
            decision={decision}
            defaultOpen
            onRespond={async (d, r) => {
              await respond(d, r);
              setOpen(false);
            }}
          />
        </Modal>
      )}
    </Card>
  );
}
