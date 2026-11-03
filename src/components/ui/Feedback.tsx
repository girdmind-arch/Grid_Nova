// hi
import type { ReactNode } from "react";
import { RotateCcw, WifiOff } from "lucide-react";
import { cn } from "@/utils/cn";
import { Button } from "./Button";
import { IconTile, type IconTileTone } from "./IconTile";

// Loading, empty and error states. Never a bare spinner, never a raw error.

/** Shimmering placeholder block used while content loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,var(--surface-sunken)_0%,var(--border)_50%,var(--surface-sunken)_100%)]",
        className,
      )}
    />
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** One clear next action. */
  action?: ReactNode;
  tone?: IconTileTone;
  className?: string;
}

export function EmptyState({ icon, title, description, action, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <IconTile icon={icon} tone={tone} size="lg" />
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  /** Human-readable message, e.g. from useService(). */
  message?: string;
  onRetry?: () => void;
  className?: string;
}

/** Calm inline error with a retry. Defaults to the "AI unreachable" wording. */
export function ErrorState({
  message = "The AI service is unreachable. Safe rule-based control is active.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/8 p-4 sm:flex-row sm:items-center",
        className,
      )}
    >
      <IconTile icon={<WifiOff />} tone="warning" size="sm" />
      <p className="flex-1 text-sm font-medium text-fg">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw /> Retry
        </Button>
      )}
    </div>
  );
}
