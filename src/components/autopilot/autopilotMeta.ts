import type { AutopilotRequest, PlanKey } from "@/types/autopilot";

// Shared labels and formatters for the Resilience Autopilot.

/** The campus buildings (same ids as backend/gridnova/campus.py). Labs are always protected. */
export const BUILDINGS: { id: string; name: string; locked?: boolean }[] = [
  { id: "lab-electrical", name: "Electrical Lab", locked: true },
  { id: "lab-cs", name: "CS Lab", locked: true },
  { id: "library", name: "Central Library" },
  { id: "admin", name: "Admin Block" },
  { id: "lecture-theatres", name: "Lecture Theatres" },
  { id: "hostel-bh1", name: "BH1" },
  { id: "hostel-bh2", name: "BH2" },
  { id: "hostel-gh1", name: "GH1" },
  { id: "hostel-gh2", name: "GH2" },
  { id: "faculty-compound", name: "Faculty Compound" },
];

/** The judges' scenario: heatwave + low solar + grid outage, dramatic but solvable. */
export const DEFAULT_REQUEST: AutopilotRequest = {
  heatSeverity: 4,
  solarPct: 35,
  outageStart: 14.5,
  outageHours: 2,
  startSoc: 70,
  runs: 40,
  protect: [],
};

export const PLAN_META: Record<PlanKey, { label: string; blurb: string }> = {
  cheapest: { label: "Cheapest", blurb: "Lowest energy bill that still passes every guardrail." },
  safest: { label: "Safest", blurb: "Most runs with protected buildings untouched, and the most battery left." },
  balanced: { label: "Balanced", blurb: "Keeps the most power flowing to everyone else for a small extra cost." },
};

export const PLAN_ORDER: PlanKey[] = ["balanced", "safest", "cheapest"];

export const HEAT_WORDS = ["None", "Mild", "Light", "Moderate", "Strong", "Severe"];

export function hhmm(hour: number) {
  const m = Math.round(hour * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const hoursText = (h: number) => (h === 1 ? "1 hour" : `${h.toString().replace(/\.0$/, "")} hours`);
