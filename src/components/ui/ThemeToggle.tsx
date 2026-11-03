// hi
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/hooks/useTheme";
import { cn } from "@/utils/cn";
import { Button } from "./Button";

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Compact top-bar toggle: an icon button that opens Light / Dark / System. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, theme, setPreference } = useTheme();
  const CurrentIcon = preference === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  const current = THEME_OPTIONS.find((o) => o.value === preference)!.label;

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${current}. Change theme`} className={className}>
          <CurrentIcon />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-44 glass-strong rounded-md border border-glass-border bg-surface-solid/92 p-1 shadow-lg data-[state=open]:animate-fade-in"
        >
          <Dropdown.Label className="px-2.5 pt-1.5 pb-1 micro-label text-fg-subtle">Theme</Dropdown.Label>
          <Dropdown.RadioGroup value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Dropdown.RadioItem
                key={value}
                value={value}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-sm font-medium text-fg outline-none pointer-coarse:h-11",
                  "data-[highlighted]:bg-surface-sunken",
                )}
              >
                <Icon aria-hidden className="size-4 text-fg-muted" />
                <span className="flex-1">{label}</span>
                <Dropdown.ItemIndicator>
                  <Check aria-hidden className="size-4 text-accent" />
                </Dropdown.ItemIndicator>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
