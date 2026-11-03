// hi
import { Check } from "lucide-react";
import type { Plan, RiskLevel } from "@/types/agents";
import { Badge } from "@/components/ui";
import { formatInr } from "@/utils/format";
import { cn } from "@/utils/cn";

const riskTone: Record<RiskLevel, "success" | "warning" | "danger"> = { low: "success", medium: "warning", high: "danger" };

function PlanMini({ plan, chosen }: { plan: Plan; chosen: boolean }) {
  const row = "flex items-center justify-between gap-2";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-md border p-3",
        chosen ? "border-ai/50 bg-ai/6 shadow-glow-ai" : "border-border bg-surface",
      )}
    >
      <p className={cn("micro-label flex items-center gap-1", chosen ? "text-ai" : "text-fg-subtle")}>
        Plan {plan.id}
        {chosen && (
          <>
            <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
            <span className="sr-only">(chosen)</span>
          </>
        )}
      </p>
      <p className="mt-1 text-sm leading-snug font-semibold text-fg">{plan.title}</p>
      <dl className="mt-2.5 space-y-1.5 text-[13px]">
        <div className={row}>
          <dt className="text-fg-muted">Cost</dt>
          <dd className="font-mono font-semibold tabular text-fg">{plan.costInr === 0 ? "No cost" : formatInr(plan.costInr)}</dd>
        </div>
        <div className={row}>
          <dt className="text-fg-muted">Risk</dt>
          <dd>
            <Badge tone={riskTone[plan.risk]} size="sm" className="h-5 px-1.5 capitalize">
              {plan.risk}
            </Badge>
          </dd>
        </div>
        <div className={row}>
          <dt className="text-fg-muted">Comfort</dt>
          <dd className="font-mono font-semibold tabular text-fg">{plan.comfortPct}%</dd>
        </div>
      </dl>
    </div>
  );
}

/** Plan A and Plan B side by side; the chosen one is highlighted with its reason. */
export function PlanCompareCard({ plans, chosenPlanId, reason }: { plans: [Plan, Plan]; chosenPlanId: Plan["id"]; reason: string }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {plans.map((p) => (
          <PlanMini key={p.id} plan={p} chosen={p.id === chosenPlanId} />
        ))}
      </div>
      <p className="mt-2 text-[13px] text-fg-muted">
        <span className="font-semibold text-fg">Why Plan {chosenPlanId}: </span>
        {reason}
      </p>
    </div>
  );
}
