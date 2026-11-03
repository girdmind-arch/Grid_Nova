// hi
import { X } from "lucide-react";
import type { GridState } from "@/types/grid";
import { formatKw, formatNumber } from "@/utils/format";

export interface Info {
  title: string;
  kicker: string;
  rows: [string, string][];
  note?: string;
  tone: "ok" | "warn" | "fault" | "ai";
}

const KIND: Record<string, string> = {
  hostel: "Hostel",
  lab: "Laboratory",
  library: "Library",
  admin: "Administration",
  academic: "Lecture theatres",
  residence: "Faculty housing",
};

const pct = (a: number, b: number) => `${b > 0 ? Math.round((a / b) * 100) : 0}%`;

/** Turns a picked node id plus the live state into a few plain-language rows. */
function describe(id: string, s: GridState): Info | null {
  const zone = s.zones.find((z) => z.id === id);
  if (zone) {
    const faulted = zone.status === "faulted" || zone.status === "isolated";
    const rerouted = zone.status === "reduced" && !!zone.note?.includes("backup feeder");
    return {
      title: zone.name,
      kicker: KIND[zone.kind] ?? "Building",
      tone: faulted ? "fault" : rerouted ? "ai" : zone.status === "reduced" ? "warn" : "ok",
      rows: [
        ["Load now", formatKw(zone.demandKw)],
        ["Share of campus", pct(zone.demandKw, s.demandKw)],
        ["Status", faulted ? "Fault" : rerouted ? "Rerouted" : zone.status === "reduced" ? "Reduced" : "Normal"],
        ["Priority", zone.priority === "critical" ? "Critical (kept on)" : zone.priority === "high" ? "High" : "Normal"],
      ],
      note: zone.note,
    };
  }
  if (id === "solar")
    return {
      title: "Solar",
      kicker: "Generation",
      tone: s.solarKw > 0 ? "ok" : "warn",
      rows: [
        ["Output", formatKw(s.solarKw)],
        ["Covers", pct(Math.min(s.solarKw, s.demandKw), s.demandKw) + " of demand"],
      ],
      note: s.environment ? `${s.environment.cloudPct}% cloud cover, ${s.environment.temperatureC}°C` : undefined,
    };
  if (id === "battery") {
    const out = Math.max(0, -s.battery.powerKw);
    const inn = Math.max(0, s.battery.powerKw);
    const kwh = (s.battery.socPct / 100) * s.battery.capacityKwh;
    return {
      title: "Battery",
      kicker: "Storage",
      tone: "ok",
      rows: [
        ["Charge", `${s.battery.socPct}% · ${formatNumber(Math.round(kwh))} kWh`],
        ["State", out > 0 ? `Supplying ${formatKw(out)}` : inn > 0 ? `Charging ${formatKw(inn)}` : "Standby"],
        ["Capacity", `${formatNumber(s.battery.capacityKwh)} kWh`],
        ...(out > 1 ? ([["Lasts about", `${(kwh / out).toFixed(1)} h at this rate`]] as [string, string][]) : []),
      ],
    };
  }
  if (id === "grid") {
    const outage = s.activeFault?.type === "grid_outage";
    return {
      title: "Main grid",
      kicker: "Supply",
      tone: outage ? "fault" : "ok",
      rows: [
        ["Import", outage ? "Offline" : formatKw(s.gridImportKw)],
        ["Tariff", `₹${s.tariff.ratePerKwh.toFixed(2)}/kWh`],
        ["Slab", s.tariff.label],
      ],
      note: outage ? "Supply lost. The battery and solar are carrying the critical load." : undefined,
    };
  }
  if (id === "bus")
    return {
      title: "Campus load",
      kicker: "Substation",
      tone: "ok",
      rows: [
        ["Demand", `${formatNumber(s.demandKw)} kW`],
        ["From solar", pct(Math.min(s.solarKw, s.demandKw), s.demandKw)],
        ["From grid", pct(s.gridImportKw, s.demandKw)],
        ["From battery", pct(Math.max(0, -s.battery.powerKw), s.demandKw)],
      ],
    };
  return null;
}

const TONE: Record<Info["tone"], string> = {
  ok: "bg-success",
  warn: "bg-warning",
  fault: "bg-danger",
  ai: "bg-ai",
};

/** A small glass card over the 3D view with the picked building's live numbers. */
export function NodeCard({ id, state, onClose }: { id: string; state: GridState; onClose: () => void }) {
  const info = describe(id, state);
  if (!info) return null;
  return <InfoCard info={info} onClose={onClose} />;
}

/** The card itself, for any 3D view (the campus, or the tabletop rig). */
export function InfoCard({ info, onClose }: { info: Info; onClose: () => void }) {
  return (
    <div
      role="status"
      style={{ zIndex: 100000 }}
      className="absolute bottom-3 left-3 right-3 rounded-lg border border-glass-border bg-surface-solid/92 p-3 text-fg shadow-[var(--shadow-sm)] sm:right-auto sm:w-64"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{info.kicker}</p>
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE[info.tone]}`} />
            <span className="truncate">{info.title}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="-m-1 rounded-md p-1 text-fg-muted hover:bg-surface-sunken hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
        {info.rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="text-right font-mono tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {info.note && <p className="mt-2 text-[13px] text-fg-muted">{info.note}</p>}
    </div>
  );
}
