// hi
import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { Ellipsis } from "lucide-react";
import { cn } from "@/utils/cn";
import { Modal } from "@/components/ui";
import { MORE_MOBILE, PRIMARY_MOBILE } from "./nav";

const itemClass = (active: boolean) =>
  cn(
    "flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors duration-150",
    active ? "text-accent" : "text-fg-muted hover:text-fg",
  );

/** Mobile/tablet bottom bar: 3 main pages + "More" (Memory, Results, Settings). */
export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const moreActive = MORE_MOBILE.some((i) => pathname.startsWith(i.to));

  return (
    <>
      <nav
        aria-label="Main"
        className="print:hidden fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+10px)] z-30 mx-auto max-w-xl rounded-2xl border border-glass-border bg-surface-solid/92 shadow-lg glass-strong lg:hidden"
      >
        <ul className="flex h-[var(--bottomnav-h)] px-1.5">
          {PRIMARY_MOBILE.map(({ to, label, icon: Icon }) => (
            <li key={to} className="flex flex-1">
              <NavLink to={to} end={to === "/app"} className={({ isActive }) => itemClass(isActive)}>
                <Icon aria-hidden className="size-[22px]" strokeWidth={1.75} />
                <span className="truncate">{label}</span>
              </NavLink>
            </li>
          ))}
          <li className="flex flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className={itemClass(moreActive)}
            >
              <Ellipsis aria-hidden className="size-[22px]" strokeWidth={1.75} />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Modal open={moreOpen} onOpenChange={setMoreOpen} title="More" variant="sheet">
        <ul className="-mx-2 space-y-1 pb-2">
          {MORE_MOBILE.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex h-12 items-center gap-3 rounded-md px-3 text-[15px] font-medium",
                    isActive ? "bg-accent/10 text-accent" : "text-fg hover:bg-surface-sunken",
                  )
                }
              >
                <Icon aria-hidden className="size-5" strokeWidth={1.75} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
