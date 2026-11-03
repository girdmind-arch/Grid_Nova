// hi
import type { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

// Status pills. Color is never the only signal: always pass a text label,
// and use `dot` or `icon` alongside it.

const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-border bg-surface-sunken text-fg-muted",
        accent: "border-accent/25 bg-accent/10 text-accent",
        success: "border-success/25 bg-success/10 text-success",
        warning: "border-warning/25 bg-warning/10 text-warning",
        danger: "border-danger/30 bg-danger/10 text-danger",
        ai: "border-ai/25 bg-ai/10 text-ai",
        onHero: "border-white/30 bg-white/15 text-hero-text",
      },
      size: {
        sm: "h-6 px-2 text-xs",
        md: "h-7 px-2.5 text-[13px]",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Small colored dot before the label. */
  dot?: boolean;
  /** Pulse the dot (for "live" or "thinking"). */
  pulse?: boolean;
  icon?: ReactNode;
}

export function Badge({ className, tone, size, dot, pulse, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && (
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current", pulse && "animate-pulse-soft")} />
      )}
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
