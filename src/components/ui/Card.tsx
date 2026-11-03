// hi
import type { ComponentPropsWithRef, HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const cardVariants = cva("rounded-lg border", {
  variants: {
    variant: {
      default: "glass border-glass-border bg-surface shadow-md",
      raised: "glass border-glass-border bg-surface-raised shadow-lg",
      /** Flat, for nested areas inside a card. */
      sunken: "border-transparent bg-surface-sunken",
      /** The gradient hero. Only ONE per screen. */
      hero: "border-white/10 bg-hero shadow-hero",
    },
    interactive: {
      true: "transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md motion-reduce:hover:translate-y-0",
      false: "",
    },
    padding: {
      none: "",
      sm: "p-4",
      md: "p-5 sm:p-6",
      lg: "p-6 sm:p-8",
    },
  },
  defaultVariants: { variant: "default", interactive: false, padding: "md" },
});

// ComponentPropsWithRef: React 19 passes `ref` as a normal prop.
export interface CardProps extends ComponentPropsWithRef<"div">, VariantProps<typeof cardVariants> {}

export function Card({ className, variant, interactive, padding, ...props }: CardProps) {
  return <div className={cn(cardVariants({ variant, interactive, padding }), className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold leading-snug text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm text-fg-muted", className)} {...props} />;
}
