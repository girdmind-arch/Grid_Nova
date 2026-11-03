// hi
import { cn } from "@/utils/cn";

type Tone = "accent" | "success" | "warning" | "danger" | "ai" | "solar";

const fill: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  ai: "bg-ai",
  solar: "bg-solar",
};

interface ProgressBarProps {
  value: number;
  max?: number;
  /** Accessible name, also shown above the bar unless hideLabel. */
  label: string;
  tone?: Tone;
  /** Text shown on the right, e.g. "82%". Defaults to the percentage. */
  valueText?: string;
  hideLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({ value, max = 100, label, tone = "accent", valueText, hideLabel, size = "md", className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const text = valueText ?? `${Math.round(pct)}%`;
  return (
    <div className={className}>
      {!hideLabel && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          <span className="text-fg-muted">{label}</span>
          <span className="font-mono font-medium tabular text-fg">{text}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className={cn("overflow-hidden rounded-full bg-surface-sunken", size === "sm" ? "h-1.5" : "h-2.5")}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300 ease-out", fill[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
