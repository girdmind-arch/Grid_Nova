// hi
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessagesSquare, MessageCircleQuestion, Siren } from "lucide-react";
import type { Decision, TraceStep } from "@/types/agents";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge, Button, Card, IconTile, Modal } from "@/components/ui";
import { AGENT_LOOK, AGENT_NAMES, STEP_META } from "@/components/agents/agentMeta";
import { ApprovalCard } from "@/components/agents/ApprovalCard";
import { ThoughtTraceItem } from "@/components/agents/ThoughtTraceItem";
import { formatInr } from "@/utils/format";
import { cn } from "@/utils/cn";
import { SCENARIOS } from "./scenarioMeta";

/**
 * The agents talking to each other while they handle a scenario. Messages are
 * the real steps of the decision the backend returned, played back one by one.
 */
export function AgentFeed({ className }: { className?: string }) {
  const active = useScenarioStore((s) => s.active);
  const stage = useScenarioStore((s) => s.stage);
  const phase = useScenarioStore((s) => s.phase);
  const decision = useScenarioStore((s) => s.liveDecision);
  const revealed = useScenarioStore((s) => s.revealed);
  const respond = useScenarioStore((s) => s.respond);
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  const steps = decision?.steps.slice(0, revealed) ?? [];
  const next = decision && revealed < decision.steps.length ? decision.steps[revealed] : null;
  const pending = phase === "awaiting-approval" && decision?.approval?.status === "pending";
  const typing = phase === "responding" && (stage === "fault" ? "fault" : next?.agent);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [revealed, stage, pending]);

  if (!active) return null;
  const meta = SCENARIOS[active.type];

  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-2.5">
        <IconTile icon={<MessagesSquare />} tone="ai" size="sm" />
        <h2 className="text-base font-semibold text-fg">Agents at work</h2>
        {phase === "responding" ? (
          <Badge tone="ai" size="sm" dot pulse className="ml-auto">
            Live
          </Badge>
        ) : pending ? (
          <Badge tone="warning" size="sm" dot pulse className="ml-auto">
            Needs you
          </Badge>
        ) : (
          <Badge tone="success" size="sm" className="ml-auto">
            Done
          </Badge>
        )}
      </div>

      <ol ref={listRef} aria-live="polite" className="mt-4 max-h-[440px] min-h-[220px] flex-1 space-y-3 overflow-y-auto pr-1">
        {/* The fault itself, always first */}
        <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
          <IconTile icon={<Siren />} tone="danger" size="sm" className="shrink-0" />
          <div className="min-w-0 rounded-md border border-danger/30 bg-danger/6 px-3 py-2">
            <p className="micro-label text-danger">Fault · {active.incidentId}</p>
            <p className="mt-0.5 text-sm font-semibold text-fg">{meta.activeLabel}.</p>
          </div>
        </motion.li>

        <AnimatePresence initial={false}>
          {steps.map((s) => (
            <Message key={s.id} step={s} decision={decision!} />
          ))}
        </AnimatePresence>

        {typing && <Typing agent={typing} />}

        {pending && decision && (
          <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <ApprovalCard decision={decision} onRespond={(r) => respond(decision, r)} />
          </motion.li>
        )}
      </ol>

      {decision && phase === "stable" && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button size="sm" onClick={() => setOpen(true)}>
            <MessageCircleQuestion /> Full reasoning
          </Button>
          {decision.usedMemory && (
            <p className="text-[13px] text-fg-muted">
              Used memory of <span className="font-semibold text-ai">{decision.usedMemory.incidentId}</span>
            </p>
          )}
        </div>
      )}

      {decision && (
        <Modal open={open} onOpenChange={setOpen} title={decision.title} description={decision.trigger}>
          <ThoughtTraceItem decision={decision} defaultOpen />
        </Modal>
      )}
    </Card>
  );
}

function Message({ step, decision }: { step: TraceStep; decision: Decision }) {
  const look = AGENT_LOOK[step.agent];
  const Icon = look.icon;
  const kind = STEP_META[step.kind];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex gap-2.5"
    >
      <IconTile icon={<Icon />} tone={look.tone} size="sm" className="shrink-0" />
      <div
        className={cn(
          "min-w-0 flex-1 rounded-md border px-3 py-2",
          step.kind === "result" ? "border-success/30 bg-success/6" : "border-border bg-surface-sunken/60",
        )}
      >
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <span className="font-semibold text-fg">{AGENT_NAMES[step.agent]}</span>
          <span className="text-fg-subtle">{kind.label}</span>
        </p>
        <p className="mt-0.5 text-sm text-fg">{step.summary}</p>
        {step.kind === "plan" && <PlanChips decision={decision} />}
        {step.detail && step.kind !== "plan" && <p className="mt-1 text-[13px] text-fg-muted">{step.detail}</p>}
      </div>
    </motion.li>
  );
}

/** Plan A vs Plan B in two chips; the chosen one is highlighted. */
function PlanChips({ decision }: { decision: Decision }) {
  return (
    <div className="mt-2 grid gap-1.5">
      {decision.plans.map((p) => {
        const chosen = p.id === decision.chosenPlanId;
        return (
          <div
            key={p.id}
            className={cn(
              "rounded-sm border px-2.5 py-1.5 text-[13px]",
              chosen ? "border-ai/40 bg-ai/8" : "border-border bg-surface",
            )}
          >
            <p className="font-semibold text-fg">
              Plan {p.id}
              {chosen && <span className="ml-1.5 text-ai">· chosen</span>}
            </p>
            <p className="truncate text-fg-muted">{p.title}</p>
            <p className="font-mono text-xs text-fg-subtle tabular">
              {formatInr(p.costInr)} · comfort {p.comfortPct}%
            </p>
          </div>
        );
      })}
    </div>
  );
}

function Typing({ agent }: { agent: keyof typeof AGENT_NAMES }) {
  const look = AGENT_LOOK[agent];
  const Icon = look.icon;
  return (
    <li className="flex items-center gap-2.5" aria-label={`${AGENT_NAMES[agent]} is working`}>
      <IconTile icon={<Icon />} tone={look.tone} size="sm" className="shrink-0 opacity-70" />
      <span className="flex items-center gap-2 text-[13px] text-fg-muted">
        {AGENT_NAMES[agent]} is working
        <span aria-hidden className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pulse-soft rounded-full bg-ai"
              style={{ animationDelay: `${i * 200}ms`, animationDuration: "1s" }}
            />
          ))}
        </span>
      </span>
    </li>
  );
}
