// hi
import { useTheme } from "@/hooks/useTheme";
import { SegmentedControl } from "./SegmentedControl";
import { THEME_OPTIONS } from "./ThemeToggle";

/** Full Light / Dark / System segmented control (used on Settings). */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl
      label="Theme"
      value={preference}
      onChange={setPreference}
      className={className}
      options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
        value,
        label,
        icon: <Icon aria-hidden />,
      }))}
    />
  );
}
