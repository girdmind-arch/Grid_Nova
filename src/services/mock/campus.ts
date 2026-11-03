// hi
// MOCK: demo campus used until the FastAPI simulator is connected.
// A mid-sized Indian campus on a hot May evening, just before the 18:00 peak.
// All numbers are illustrative but internally consistent:
// demand 1,240 kW = solar 310 + battery 0 + grid 930.

import type { Tariff, Zone } from "@/types/grid";

export { SIM_START } from "@/utils/simTime";

// MOCK: zones and their demand at 17:20.
export const ZONES: Zone[] = [
  { id: "hostel-bh1", name: "BH1", kind: "hostel", demandKw: 150, status: "normal", priority: "normal" },
  { id: "hostel-bh2", name: "BH2", kind: "hostel", demandKw: 138, status: "normal", priority: "normal" },
  { id: "hostel-gh1", name: "GH1", kind: "hostel", demandKw: 128, status: "normal", priority: "normal" },
  { id: "hostel-gh2", name: "GH2", kind: "hostel", demandKw: 116, status: "normal", priority: "normal" },
  { id: "lab-electrical", name: "Electrical Lab", kind: "lab", demandKw: 196, status: "normal", priority: "critical" },
  { id: "lab-cs", name: "Computer Science Lab", kind: "lab", demandKw: 164, status: "normal", priority: "critical" },
  { id: "library", name: "Central Library", kind: "library", demandKw: 100, status: "normal", priority: "high" },
  { id: "lecture-theatres", name: "Lecture Theatres", kind: "academic", demandKw: 70, status: "normal", priority: "high" },
  { id: "admin", name: "Admin Block", kind: "admin", demandKw: 82, status: "normal", priority: "high" },
  { id: "faculty-compound", name: "Faculty Compound", kind: "residence", demandKw: 96, status: "normal", priority: "normal" },
];

// 2 MWh campus battery; 20–90% is the usable window set by the Guardrail.
export const BATTERY_CAPACITY_KWH = 2000;

// MOCK: UPPCL-style time-of-day tariff (illustrative rates, not official).
export const TARIFF_SLABS: (Tariff & { fromHour: number; toHour: number })[] = [
  { slab: "off-peak", ratePerKwh: 6.9, label: "Off-peak · 22:00–06:00", fromHour: 22, toHour: 6 },
  { slab: "normal", ratePerKwh: 8.25, label: "Normal · 06:00–18:00", fromHour: 6, toHour: 18 },
  { slab: "peak", ratePerKwh: 9.7, label: "Peak · 18:00–22:00", fromHour: 18, toHour: 22 },
];

export function tariffAt(hour: number): Tariff {
  const slab =
    hour >= 18 && hour < 22 ? TARIFF_SLABS[2] : hour >= 6 && hour < 18 ? TARIFF_SLABS[1] : TARIFF_SLABS[0];
  return { slab: slab.slab, ratePerKwh: slab.ratePerKwh, label: slab.label };
}

// MOCK: hourly demand (kW) and solar (kW) profile for a hot weekday.
// Evening peak 18:00–22:00, solar peaking around midday (~720 kW array).
export const HOURLY_DEMAND_KW = [
  610, 580, 560, 550, 560, 620, 760, 900, 1010, 1080, 1120, 1150,
  1170, 1160, 1140, 1150, 1190, 1240, 1420, 1510, 1480, 1390, 1120, 820,
];
export const HOURLY_SOLAR_KW = [
  0, 0, 0, 0, 0, 0, 20, 130, 300, 470, 610, 690,
  720, 700, 630, 520, 400, 260, 90, 10, 0, 0, 0, 0,
];
