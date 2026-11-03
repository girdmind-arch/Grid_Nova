// hi
// MOCK: next-12-hour forecast from the Forecaster agent.

import type { Forecast } from "@/types/grid";
import { HOURLY_DEMAND_KW, HOURLY_SOLAR_KW, SIM_START, tariffAt } from "./campus";

const at = (hhmm: string) => `2026-05-12T${hhmm}:00+05:30`;

export function buildForecast(): Forecast {
  const startHour = 17;
  const points = Array.from({ length: 12 }, (_, i) => {
    const hour = (startHour + i) % 24;
    const day = startHour + i >= 24 ? "13" : "12";
    return {
      time: `2026-05-${day}T${String(hour).padStart(2, "0")}:00:00+05:30`,
      demandKw: HOURLY_DEMAND_KW[hour],
      solarKw: HOURLY_SOLAR_KW[hour],
      tariffInr: tariffAt(hour).ratePerKwh,
    };
  });

  return {
    generatedAt: SIM_START,
    horizonHours: 12,
    points,
    events: [
      { id: "ev-1", time: at("18:00"), title: "Evening peak begins", detail: "Tariff rises to ₹9.70/kWh until 22:00.", kind: "tariff" },
      { id: "ev-2", time: at("18:40"), title: "Solar output drops below 100 kW", detail: "Sunset at 18:52. Battery takes over.", kind: "solar" },
      { id: "ev-3", time: at("19:00"), title: "Campus demand peaks", detail: "Forecast 1,510 kW (±4%) as hostels fill up.", kind: "peak" },
      { id: "ev-4", time: at("22:00"), title: "Off-peak tariff", detail: "Recharge battery at ₹6.90/kWh overnight.", kind: "tariff" },
    ],
  };
}
