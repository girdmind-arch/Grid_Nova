// hi
import { Lock } from "lucide-react";
import { getGuardrails } from "@/services";
import { useService } from "@/hooks/useService";
import { ErrorState, Skeleton } from "@/components/ui";

/** The hard rules no agent can override. Read-only by design. */
export function GuardrailRules({ columns = 2 }: { columns?: 1 | 2 | 3 }) {
  const rules = useService(getGuardrails);

  if (rules.status === "error" && !rules.data) return <ErrorState message={rules.error} onRetry={rules.retry} />;
  if (!rules.data) return <Skeleton className="h-40" />;

  return (
    <ul className={columns === 3 ? "grid gap-2.5 md:grid-cols-2 xl:grid-cols-3" : columns === 2 ? "grid gap-2.5 md:grid-cols-2" : "grid gap-2.5"}>
      {rules.data.map((r) => (
        <li key={r.id} className="flex gap-3 rounded-md border border-success/25 bg-success/6 p-3">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <div>
            <p className="text-sm font-semibold text-fg">{r.rule}</p>
            <p className="mt-0.5 text-[13px] text-fg-muted">{r.why}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
