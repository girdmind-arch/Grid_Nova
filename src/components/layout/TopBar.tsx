import { useAppStore } from "@/store/appStore";
import { ModeIndicator, ThemeToggle } from "@/components/ui";
import { Logo } from "./Logo";
import { DataSourceSwitch, LiveWeather, Notifications, OperatorAvatar, SearchButton, SimClock } from "./TopBarParts";

/** Top bar: search, simulated clock, mode pill, theme, notifications, operator. */
export function TopBar() {
  const mode = useAppStore((s) => s.mode);

  return (
    <header className="print:hidden sticky top-0 z-20 px-[var(--gutter)] pt-[calc(env(safe-area-inset-top)+12px)] lg:px-[var(--gutter-lg)]">
      <div className="glass-strong mx-auto flex h-[58px] max-w-[var(--content-max)] items-center gap-2 rounded-xl border border-glass-border bg-surface-solid/92 px-2.5 shadow-md sm:gap-3 sm:px-3">
        {/* Logo only on mobile/tablet; desktop has it in the sidebar */}
        <Logo to="/app" compact className="lg:hidden" />
        <SearchButton />

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <LiveWeather className="mr-3 hidden xl:flex" />
          <SimClock className="mr-2 hidden sm:flex" />
          <DataSourceSwitch className="mr-1 hidden md:flex" />
          <ModeIndicator mode={mode} className="hidden sm:inline-flex" />
          <ModeIndicator mode={mode} compact className="sm:hidden" />
          <ThemeToggle />
          <Notifications />
          <OperatorAvatar />
        </div>
      </div>
    </header>
  );
}
