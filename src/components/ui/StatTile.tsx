// hi
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Trend } from "@/types/grid";
import { useCountUp } from "@/hooks/useCountUp";
import { formatNumber } from "@/utils/format";
import { cn } from "@/utils/cn";
import { IconTile, type IconTileTone } from "./IconTile";

interface StatTileProps {
  label: string;
  value: number;
  /** Unit after the number, e.g. "kW" or "%". */
  unit?: string;
  /** Text before the number, e.g. "₹". */
  prefix?: string;
  digits?: number;
  icon?: ReactNode;
  tone?: IconTileTone;
  trend?: Trend;
  /** Short words for the trend, e.g. "rising" or "+6% vs 1h ago". */
  trendLabel?: string;
  className?: string;
}

const trendIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus };
const trendWord = { up: "Rising", down: "Falling", flat: "Steady" };

/** A single number with label, count-up animation and a small trend arrow. */
export function StatTile({ label, value, unit, prefix, digits = 0, icon, tone = "accent", trend, trendLabel, className }: StatTileProps) {
  const animated = useCountUp(value);
  const TrendIcon = trend ? trendIcon[trend] : null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3 glass rounded-lg border border-glass-border bg-surface p-4 shadow-md", className)}>
      <div className="flex items-center gap-2.5">
        {icon && <IconTile icon={icon} tone={tone} size="sm" />}
        <span className="micro-label truncate text-fg-muted">{label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="font-mono text-2xl font-semibold tracking-tight tabular text-fg">
          {prefix}
          {formatNumber(animated, digits)}
        </span>
        {unit && <span className="text-sm font-medium text-fg-muted">{unit}</span>}
        <span className="sr-only">
          {/* Screen readers get the final value, not every animation frame. */}
          {label}: {prefix}
          {formatNumber(value, digits)} {unit}
        </span>
      </div>
      {trend && TrendIcon && (
        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-fg-muted">
          <TrendIcon aria-hidden className="size-4" />
          {trendLabel ?? trendWord[trend]}
        </span>
      )}
    </div>
  );
}
