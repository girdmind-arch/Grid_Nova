// hi
import { useId, useState } from "react";
import { ChevronDown, History, MessageCircleQuestion } from "lucide-react";
import type { ApprovalResponse, Decision, TraceStep } from "@/types/agents";
import { Badge, Button, Modal } from "@/components/ui";
import { USE_MOCKS } from "@/services";
import { formatTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { AGENT_NAMES, STEP_META } from "./agentMeta";
import { PlanCompareCard } from "./PlanCompareCard";
import { ApprovalCard } from "./ApprovalCard";

interface ThoughtTraceItemProps {
  decision: Decision;
  defaultOpen?: boolean;
  onRespond?: (decision: Decision, response: ApprovalResponse) => Promise<void>;
}

/** One decision: Observe → Reason → Plan A vs B → Safety ✓ → Act → Result. */
export function ThoughtTraceItem({ decision, defaultOpen = false, onRespond }: ThoughtTraceItemProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const pending = decision.approval?.status === "pending";

  return (
    <article className="rounded-lg border border-border bg-surface">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-start gap-3 rounded-lg p-3.5 text-left hover:bg-surface-sunken/60"
        >
          <span className="mt-0.5 font-mono text-xs font-medium tabular text-fg-subtle">{formatTime(decision.startedAt)}</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm leading-snug font-semibold text-fg">{decision.title}</span>
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {pending && (
                <Badge tone="warning" size="sm" dot pulse>
                  Waiting for you
                </Badge>
              )}
              {decision.approval?.status === "rejected" && <Badge tone="warning" size="sm">Rejected · rules active</Badge>}
              {decision.approval && ["approved", "modified"].includes(decision.approval.status) && (
                <Badge tone="success" size="sm">
                  {decision.approval.status === "approved" ? "Approved" : "Modified"} by operator
                </Badge>
              )}
              {decision.usedMemory && (
                <Badge tone="ai" size="sm" icon={<History />}>
                  Similar past incident
                </Badge>
              )}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 text-fg-subtle transition-transform duration-200", open && "rotate-180")}
          />
        </button>
      </h3>

      {open && (
        <div id={bodyId} className="border-t border-border px-3.5 pt-3 pb-4">
          <p className="text-[13px] text-fg-muted">
            <span className="font-semibold text-fg">Trigger: </span>
            {decision.trigger}
          </p>
          {decision.usedMemory && (
            <p className="mt-1.5 text-[13px] text-fg-muted">
              <span className="font-semibold text-ai">Memory {decision.usedMemory.incidentId}: </span>
              {decision.usedMemory.summary}
            </p>
          )}

          <ol className="mt-3.5">
            {decision.steps.map((step, i) => (
              <StepRow key={step.id} step={step} last={i === decision.steps.length - 1 && !pending}>
                {step.kind === "plan" && (
                  <div className="mt-2.5">
                    <PlanCompareCard plans={decision.plans} chosenPlanId={decision.chosenPlanId} reason={decision.chosenReason} />
                  </div>
                )}
                {step.kind === "safety" && pending && onRespond && (
                  <div className="mt-2.5">
                    <ApprovalCard decision={decision} onRespond={(r) => onRespond(decision, r)} />
                  </div>
                )}
                {step.kind === "act" && (
                  <>
                    {decision.approval?.response && (
                      <p className="mt-1 text-[13px] text-fg-muted">{decision.approval.response.note}</p>
                    )}
                    <WhyButton decision={decision} />
                  </>
                )}
              </StepRow>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

function StepRow({ step, last, children }: { step: TraceStep; last: boolean; children?: React.ReactNode }) {
  const [showDetail, setShowDetail] = useState(false);
  const { label, icon: Icon } = STEP_META[step.kind];
  const done = step.kind === "result" || step.kind === "safety";

  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {/* timeline rail */}
      {!last && <span aria-hidden className="absolute top-8 bottom-1 left-[13px] w-px bg-border" />}
      <span
        aria-hidden
        className={cn(
          "relative grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5",
          done ? "bg-success/12 text-success" : "bg-ai/12 text-ai",
        )}
      >
        <Icon strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-fg">
            {label}
            {step.kind === "safety" && " ✓"}
          </span>
          <span className="text-fg-subtle">{AGENT_NAMES[step.agent]}</span>
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">{step.summary}</p>
        {step.detail && (
          <>
            <button
              type="button"
              onClick={() => setShowDetail((s) => !s)}
              aria-expanded={showDetail}
              className="mt-1 text-xs font-semibold text-accent hover:underline pointer-coarse:py-2"
            >
              {showDetail ? "Hide detail" : "Show detail"}
            </button>
            {showDetail && <p className="mt-1 rounded-sm bg-surface-sunken px-2.5 py-2 text-[13px] text-fg-muted">{step.detail}</p>}
          </>
        )}
        {children}
      </div>
    </li>
  );
}

function WhyButton({ decision }: { decision: Decision }) {
  return (
    <Modal
      title="Why did you do that?"
      description={decision.title}
      trigger={
        <Button variant="ghost" size="sm" className="mt-1.5 -ml-2.5 text-ai hover:text-ai">
          <MessageCircleQuestion /> Why did you do that?
        </Button>
      }
    >
      <p className="text-[15px] leading-relaxed text-fg">{decision.explanation}</p>
      <div className="mt-4 rounded-md bg-surface-sunken p-3 text-sm text-fg-muted">
        <span className="font-semibold text-fg">In one line: </span>
        {decision.chosenReason}
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        {USE_MOCKS
          ? "Demo explanation: pre-written until the agent backend is connected."
          : "Explanation built by the Orchestrator from its digital-twin results."}
      </p>
    </Modal>
  );
}
