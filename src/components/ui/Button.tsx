// hi
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px] [&_svg]:shrink-0",
    "active:translate-y-px",
  ],
  {
    variants: {
      variant: {
        /** The one main action on a screen. */
        primary: "bg-accent text-on-accent shadow-sm hover:bg-accent-hover",
        /** Secondary actions. */
        secondary: "glass border border-glass-border bg-surface-raised text-fg shadow-sm hover:bg-surface",
        /** Low-emphasis actions, icon buttons in bars. */
        ghost: "text-fg-muted hover:bg-surface-sunken hover:text-fg",
        /** Destructive or fault-related actions. */
        danger: "bg-danger text-on-accent shadow-sm hover:opacity-90",
        /** Primary action placed on the gradient hero. */
        onHero: "bg-[#f6efe4] text-[var(--hero-from)] shadow-sm hover:bg-white",
        /** Secondary action placed on the gradient hero. */
        onHeroGhost: "border border-white/40 text-hero-text hover:bg-white/10",
      },
      size: {
        sm: "h-9 px-3 text-sm pointer-coarse:h-11",
        md: "h-11 px-4 text-[15px]",
        lg: "h-12 px-6 text-base",
        icon: "size-10 pointer-coarse:size-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a router <Link>) with button styles. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
