// hi
import { Bot, Hand, ShieldCheck } from "lucide-react";
import type { ControlMode } from "@/types/grid";
import { Badge } from "./Badge";

// Always-visible "who is in control" pill. Fallback is not an error,
// so it is worded calmly.

export const MODE_INFO: Record<
  ControlMode,
  { label: string; short: string; description: string; tone: "success" | "warning" | "danger"; icon: typeof Bot }
> = {
  ai: {
    label: "AI Control",
    short: "AI",
    description: "GridNova agents are managing the grid.",
    tone: "success",
    icon: Bot,
  },
  fallback: {
    label: "Fallback Rules",
    short: "Rules",
    description: "Safe rule-based control is active.",
    tone: "warning",
    icon: ShieldCheck,
  },
  manual: {
    label: "Manual",
    short: "Manual",
    description: "An operator is controlling the grid by hand.",
    tone: "danger",
    icon: Hand,
  },
};

interface ModeIndicatorProps {
  mode: ControlMode;
  /** Shorter label for small screens. */
  compact?: boolean;
  className?: string;
}

export function ModeIndicator({ mode, compact, className }: ModeIndicatorProps) {
  const info = MODE_INFO[mode];
  return (
    <Badge
      tone={info.tone}
      dot
      pulse={mode === "ai"}
      title={info.description}
      aria-label={`Control mode: ${info.label}. ${info.description}`}
      role="status"
      className={className}
    >
      {compact ? info.short : info.label}
    </Badge>
  );
}
