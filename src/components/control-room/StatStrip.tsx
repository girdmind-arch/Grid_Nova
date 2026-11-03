// hi
import { Battery, Gauge, SunMedium, UtilityPole } from "lucide-react";
import type { GridState } from "@/types/grid";
import { StatTile } from "@/components/ui";

/** Demand · Solar · Battery % · Grid draw */
export function StatStrip({ state }: { state: GridState }) {
  const t = state.trends;
  const outage = state.activeFault?.type === "grid_outage";
  const batteryKw = Math.max(0, -state.battery.powerKw);
  const chargingKw = Math.max(0, state.battery.powerKw);
  return (
    <section aria-label="Grid at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Demand" value={state.demandKw} unit="kW" icon={<Gauge />} tone="accent" trend={t.demand} trendLabel={t.demand === "up" ? "Rising to peak" : undefined} />
      <StatTile label="Solar" value={state.solarKw} unit="kW" icon={<SunMedium />} tone="solar" trend={t.solar} trendLabel={t.solar === "down" ? "Fading to sunset" : undefined} />
      <StatTile
        label="Battery"
        value={state.battery.socPct}
        unit="%"
        icon={<Battery />}
        tone="success"
        trend={t.battery}
        trendLabel={batteryKw > 0 ? `Supplying ${batteryKw} kW` : chargingKw > 0 ? `Charging ${chargingKw} kW` : "Standby, ready"}
      />
      <StatTile
        label="Grid draw"
        value={state.gridImportKw}
        unit="kW"
        icon={<UtilityPole />}
        tone="accent"
        trend={outage ? "flat" : t.grid}
        trendLabel={outage ? "Grid offline" : undefined}
      />
    </section>
  );
}
