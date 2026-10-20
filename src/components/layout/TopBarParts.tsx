import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Bell, CloudSun, LogOut, Search } from "lucide-react";
import { AUTH_REQUIRED, signOut } from "@/services/auth";
import { ServiceError, USE_MOCKS, setHardwareMode } from "@/services";
import type { DataSource } from "@/types/hardware";
import { useHardwareState } from "@/components/settings/HardwareDemo";
import { useAuthStore, useCanAct } from "@/store/authStore";
import { useSimClock } from "@/hooks/useSimClock";
import { useAppStore } from "@/store/appStore";
import { formatDate, formatTime } from "@/utils/format";
import { cn } from "@/utils/cn";
import { Button, Modal, toast } from "@/components/ui";
import { NAV_ITEMS } from "./nav";

// ---------- Simulated clock ----------
export function SimClock({ className }: { className?: string }) {
  const now = useSimClock();
  const env = useAppStore((s) => s.environment);
  const label = !env ? "Sim time · IST" : env.clock === "live" ? "Live · IST" : `Demo evening · ${env.speed}×`;
  const title = !env
    ? "Simulated campus time (IST)"
    : env.clock === "live"
      ? "Real Indian time; the campus runs live"
      : `Demo clock running ${env.speed}× faster than real time`;
  return (
    <div className={cn("flex flex-col leading-tight whitespace-nowrap", className)} title={title}>
      <span className="micro-label flex items-center gap-1.5 text-[11px] text-fg-subtle">
        {env && <span aria-hidden className="size-1.5 animate-pulse-soft rounded-full bg-success" />}
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular text-fg">
        <time dateTime={now.toISOString()}>
          {formatTime(now)} <span className="font-sans font-medium text-fg-muted">· {formatDate(now)}</span>
        </time>
      </span>
    </div>
  );
}

// ---------- Live weather from the backend ----------
export function LiveWeather({ className }: { className?: string }) {
  const env = useAppStore((s) => s.environment);
  if (!env) return null;
  const live = env.weatherSource === "open-meteo";
  return (
    <div
      className={cn("flex flex-col leading-tight whitespace-nowrap", className)}
      title={live ? `Live weather from Open-Meteo for ${env.location}` : "Weather service unreachable: using a typical-day profile"}
    >
      <span className="micro-label text-[11px] text-fg-subtle">{live ? `Weather · ${env.location}` : "Weather · typical day"}</span>
      <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
        <CloudSun aria-hidden strokeWidth={1.75} className="size-4 text-solar" />
        <span className="font-mono tabular">{Math.round(env.temperatureC)}°C</span>
        <span className="font-medium text-fg-muted">· {env.cloudPct}% cloud</span>
      </span>
    </div>
  );
}

// ---------- Search (pages only for now) ----------
function useSearchResults(query: string) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((i) => `${i.label} ${i.keywords}`.toLowerCase().includes(q));
  }, [query]);
}

function SearchPanel({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState("");
  const results = useSearchResults(query);
  const navigate = useNavigate();
  const go = (to: string) => {
    navigate(to);
    onDone();
  };

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) go(results[0].to);
        }}
        className="relative"
      >
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-fg-subtle" />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try “battery”, “outage”, “results”…"
          aria-label="Search GridNova"
          className="h-11 w-full rounded-md border border-border bg-surface pr-3 pl-10 text-[15px] text-fg placeholder:text-fg-subtle"
        />
      </form>
      <ul className="mt-3 space-y-1" aria-label="Results">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">No matches. Try a page name.</li>}
        {results.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <button
              type="button"
              onClick={() => go(to)}
              className="flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] font-medium text-fg hover:bg-surface-sunken"
            >
              <Icon aria-hidden className="size-[18px] text-fg-muted" />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Search button: a field-like trigger on desktop, an icon on mobile. Opens a search dialog. */
export function SearchButton() {
  const [open, setOpen] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Jump to a page."
      trigger={
        <button
          type="button"
          aria-label="Search"
          className={cn(
            "flex items-center gap-2.5 rounded-md text-fg-subtle transition-colors hover:text-fg",
            "size-10 justify-center pointer-coarse:size-11 md:h-10 md:w-64 md:justify-start md:border md:border-border md:bg-surface-sunken md:px-3 xl:w-44 2xl:w-64",
          )}
        >
          <Search aria-hidden className="size-[18px] shrink-0" />
          <span className="hidden text-sm md:inline">Search pages…</span>
        </button>
      }
    >
      <SearchPanel onDone={() => setOpen(false)} />
    </Modal>
  );
}

// ---------- Notifications ----------
// MOCK: notifications will come from the agent event stream.
const NOTIFICATIONS = [
  { id: 1, title: "Plan B is active", detail: "Battery held at 82% for the evening peak.", time: "17:15" },
  { id: 2, title: "Lesson applied", detail: "Pre-cooling hostels 30 min before peak.", time: "17:14" },
  { id: 3, title: "Forecast updated", detail: "Peak of 1,510 kW expected at 19:00.", time: "17:12" },
];

export function Notifications() {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications, ${NOTIFICATIONS.length} new`} className="relative">
          <Bell />
          <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full bg-accent ring-2 ring-surface" />
        </Button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(340px,calc(100vw-32px))] glass-strong rounded-lg border border-glass-border bg-surface-solid/92 p-1.5 shadow-lg data-[state=open]:animate-fade-in"
        >
          <Dropdown.Label className="micro-label px-2.5 pt-2 pb-1.5 text-fg-subtle">Notifications</Dropdown.Label>
          {NOTIFICATIONS.map((n) => (
            <Dropdown.Item
              key={n.id}
              className="flex cursor-default flex-col gap-0.5 rounded-md px-2.5 py-2.5 outline-none data-[highlighted]:bg-surface-sunken"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-fg">{n.title}</span>
                <span className="font-mono text-xs text-fg-subtle">{n.time}</span>
              </span>
              <span className="text-[13px] text-fg-muted">{n.detail}</span>
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ---------- Operator avatar / account menu ----------
export function OperatorAvatar() {
  const session = useAuthStore((s) => s.session);
  const navigate = useNavigate();

  // Demo data has no accounts: a plain badge.
  if (!AUTH_REQUIRED || !session) {
    return (
      <span
        role="img"
        aria-label="Signed in as Duty Operator"
        title="Duty Operator"
        className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface-sunken text-[13px] font-bold text-fg-muted"
      >
        DO
      </span>
    );
  }
  const initials = session.name.slice(0, 2).toUpperCase();
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={`Account menu, signed in as ${session.name} (${session.role})`}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-surface-sunken text-[13px] font-bold text-fg-muted hover:text-fg pointer-coarse:size-11"
        >
          {initials}
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 w-[min(260px,calc(100vw-32px))] glass-strong rounded-lg border border-glass-border bg-surface-solid/92 p-1.5 shadow-lg data-[state=open]:animate-fade-in"
        >
          <div className="px-2.5 pt-2 pb-2.5">
            <p className="truncate text-sm font-semibold text-fg">{session.name}</p>
            <p className="mt-0.5 text-[13px] text-fg-muted">{session.role === "operator" ? "Operator: can run scenarios and approve plans" : "Viewer: read-only"}</p>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-border" />
          <Dropdown.Item
            onSelect={() => {
              signOut();
              navigate("/login", { replace: true });
            }}
            className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2.5 text-sm font-medium text-fg outline-none data-[highlighted]:bg-surface-sunken"
          >
            <LogOut aria-hidden className="size-4" strokeWidth={1.75} /> Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

// ---------- Data source: simulated campus or the tabletop rig ----------
export function DataSourceSwitch({ className }: { className?: string }) {
  if (USE_MOCKS) return null;
  return <DataSourceSwitchLive className={className} />;
}

function DataSourceSwitchLive({ className }: { className?: string }) {
  const { state, set, refresh } = useHardwareState();
  const canAct = useCanAct();
  if (!state?.configured) return null;
  const rig = state.mode === "hardware-demo";
  const pick = async (mode: DataSource) => {
    if (mode === state.mode) return;
    try {
      set(await setHardwareMode(mode));
      toast({
        title: mode === "hardware-demo" ? "Hardware demo on" : "Simulation only",
        description: mode === "hardware-demo" ? "The rig's readings now drive the demo. Arm it in Settings → Hardware to let the agents act on it." : "Nothing is sent to the rig.",
        tone: "ai",
      });
    } catch (e) {
      toast({ title: "Not switched.", description: e instanceof ServiceError ? e.message : "Try again.", tone: "warning" });
      void refresh();
    }
  };
  const btn = (on: boolean) =>
    cn("h-8 rounded-full px-3 text-[13px] font-semibold transition-colors", on ? "bg-accent text-on-accent" : "text-fg-muted hover:text-fg");
  return (
    <div role="group" aria-label="Data source: simulated or hardware" className={cn("items-center gap-0.5 rounded-full border border-border bg-surface-sunken p-0.5", className)}>
      <button type="button" aria-pressed={!rig} disabled={!canAct} onClick={() => void pick("simulation")} className={btn(!rig)} title="Simulated campus only">
        Sim
      </button>
      <button type="button" aria-pressed={rig} disabled={!canAct} onClick={() => void pick("hardware-demo")} className={btn(rig)} title="Hardware: the tabletop rig's readings drive the demo">
        <span className="inline-flex items-center gap-1.5">
          {rig && <span aria-hidden className={cn("size-1.5 rounded-full", state.device.status === "online" ? "bg-success" : "bg-fg-subtle")} />}
          Rig
        </span>
      </button>
    </div>
  );
}
