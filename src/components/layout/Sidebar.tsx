// hi
import { NavLink } from "react-router";
import { FlaskConical } from "lucide-react";
import { USE_MOCKS } from "@/services";
import { cn } from "@/utils/cn";
import { NAV_ITEMS } from "./nav";
import { Logo } from "./Logo";

/** Desktop sidebar (lg and up). */
export function Sidebar() {
  return (
    <aside className="print:hidden fixed top-3 bottom-3 left-3 z-30 hidden w-[calc(var(--sidebar-w)-24px)] flex-col overflow-y-auto rounded-xl border border-glass-border bg-surface shadow-lg glass-strong lg:flex">
      <div className="flex h-[58px] items-center px-4 pt-1">
        <Logo to="/app" />
      </div>

      <nav aria-label="Main" className="flex-1 px-2.5 py-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/app"}
                className={({ isActive }) =>
                  cn(
                    "group flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors duration-150",
                    isActive ? "glass border border-glass-border bg-surface-raised text-accent shadow-sm" : "border border-transparent text-fg-muted hover:bg-surface-raised hover:text-fg",
                  )
                }
              >
                <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="m-2.5 flex items-start gap-2.5 rounded-lg bg-surface-sunken p-3 text-[13px] leading-snug text-fg-muted">
        <FlaskConical aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          {USE_MOCKS
            ? "Simulated campus. Demo data until the backend is connected."
            : "Simulated campus, computed live by the GridNova backend."}
        </span>
      </div>
    </aside>
  );
}
