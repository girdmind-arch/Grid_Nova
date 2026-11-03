// hi
import { useId, type ReactNode } from "react";
import { cn } from "@/utils/cn";

// A row of mutually exclusive options. Built on native radio inputs, so
// keyboard support (Tab in, arrow keys to move) and screen readers work for free.

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  /** Accessible name for the whole group. */
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-grid auto-cols-fr grid-flow-col gap-1 rounded-md bg-surface-sunken p-1", className)}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "relative flex h-10 cursor-pointer items-center justify-center gap-2 rounded-sm px-3 text-sm font-semibold pointer-coarse:h-11",
              "transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus [&_svg]:size-4",
              checked ? "bg-surface-raised text-fg shadow-sm" : "text-fg-muted hover:text-fg",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.icon}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
