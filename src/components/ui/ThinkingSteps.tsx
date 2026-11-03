// hi
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/utils/cn";

// The AI loading state: shows what the agents are doing instead of a spinner.
// "Reading grid state... → Forecasting demand... → Testing plans... → Decision ready ✓"

export const DEFAULT_THINKING_STEPS = [
  "Reading grid state",
  "Forecasting demand",
  "Testing plans in the digital twin",
  "Decision ready",
];

interface ThinkingStepsProps {
  steps?: string[];
  /** True once the real result has arrived; jumps to the final step. */
  done?: boolean;
  /** Time per step while waiting. */
  stepMs?: number;
  className?: string;
}

export function ThinkingSteps({ steps = DEFAULT_THINKING_STEPS, done = false, stepMs = 700, className }: ThinkingStepsProps) {
  const last = steps.length - 1;
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (done) {
      setActive(last);
      return;
    }
    // Advance through the waiting steps, but never claim "ready" until done.
    const id = window.setInterval(() => setActive((i) => Math.min(i + 1, last - 1)), stepMs);
    return () => window.clearInterval(id);
  }, [done, last, stepMs]);

  return (
    <ol aria-live="polite" className={cn("space-y-2", className)}>
      {steps.map((step, i) => {
        const complete = i < active || (done && i === last);
        const current = i === active && !complete;
        if (i > active) return null;
        return (
          <li key={step} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full",
                complete ? "bg-success/15 text-success" : "bg-ai/15 text-ai",
              )}
            >
              {complete ? <Check className="size-3" strokeWidth={3} /> : <span className="size-1.5 animate-pulse-soft rounded-full bg-current" />}
            </span>
            <span className={cn(current ? "font-medium text-fg" : "text-fg-muted")}>
              {step}
              {current ? "…" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
