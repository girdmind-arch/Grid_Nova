// hi
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

// Rounded-square icon holder. Each feature keeps one tint across the app:
// solar = solar, battery/healthy = success, grid/neutral = accent,
// agents = ai, faults = danger, warnings = warning.

export type IconTileTone = "accent" | "success" | "warning" | "danger" | "ai" | "solar" | "neutral";

const tones: Record<IconTileTone, string> = {
  accent: "bg-accent/10 text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  ai: "bg-ai/10 text-ai",
  solar: "bg-solar/12 text-solar",
  neutral: "bg-surface-sunken text-fg-muted",
};

interface IconTileProps {
  icon: ReactNode;
  tone?: IconTileTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function IconTile({ icon, tone = "accent", size = "md", className }: IconTileProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center",
        size === "sm" && "size-8 rounded-sm [&_svg]:size-4",
        size === "md" && "size-10 rounded-md [&_svg]:size-5",
        size === "lg" && "size-12 rounded-md [&_svg]:size-6",
        tones[tone],
        className,
      )}
    >
      {icon}
    </span>
  );
}
