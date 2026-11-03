// hi
// MOCK: in-memory grid state. The real backend owns this state; here it lives
// in the browser so the demo works offline.
//
// Each scenario has two phases:
//   1. unmitigated: the fault has hit and nobody has acted yet
//   2. mitigated:   the agents' plan has been applied (or safe rules, if rejected)
// Solar + battery + grid always equals demand, so the numbers stay believable.

import type { ActiveFault, ControlMode, FaultRequest, FaultType, GridState, PowerFlow, Trend, Zone } from "@/types/grid";
import { simNow } from "@/utils/simTime";
import { BATTERY_CAPACITY_KWH, ZONES, tariffAt } from "./campus";

const NORMAL_SOLAR_KW = 310;
const DEFAULT_LINE_FAULT_ZONE = "hostel-gh1";

let activeFault: ActiveFault | null = null;
let mode: ControlMode = "ai";
/** Hostel power level used in a grid outage (operator can modify it). */
let outageHostelLevel = 0.6;
let incidentCounter = 41; // continues after the incidents in memory.ts
/** How many times each scenario type has been run this session (for learning). */
const runCounts: Partial<Record<FaultType, number>> = {};
/** Incident id of the previous run of each type (memory for replays). */
const lastIncident: Partial<Record<FaultType, string>> = {};

function zonesNow(): Zone[] {
  const f = activeFault;
  return ZONES.map((z): Zone => {
    if (!f) return z;

    if (f.type === "line_failure" && (f.targetZoneId ?? DEFAULT_LINE_FAULT_ZONE) === z.id) {
      return f.mitigated
        ? { ...z, status: "reduced", demandKw: Math.round(z.demandKw * 0.96), note: "On backup feeder F2" }
        : { ...z, status: "faulted", demandKw: 0, note: "Feeder F3 fault" };
    }

    if (f.type === "grid_outage" && z.kind === "hostel") {
      return f.mitigated
        ? { ...z, status: "reduced", demandKw: Math.round(z.demandKw * outageHostelLevel), note: `Running at ${Math.round(outageHostelLevel * 100)}%` }
        : { ...z, status: "faulted", demandKw: 0, note: "No supply" };
    }

    if (f.type === "heatwave") {
      const hotter = Math.round(z.demandKw * (1 + f.severity * 0.04));
      if (f.mitigated && z.kind === "hostel") {
        return { ...z, status: "reduced", demandKw: Math.round(hotter * 0.94), note: "Pre-cooling, +1°C" };
      }
      return { ...z, demandKw: hotter };
    }

    return z;
  });
}

// MOCK: builds a consistent snapshot for the current scenario phase.
export function buildGridState(now: Date): GridState {
  const zones = zonesNow();
  const f = activeFault;
  const demandKw = zones.reduce((sum, z) => sum + z.demandKw, 0);

  const solarKw = f?.type === "cloud_cover" ? Math.round(NORMAL_SOLAR_KW * (1 - f.severity * 0.15)) : NORMAL_SOLAR_KW;
  const solarGap = NORMAL_SOLAR_KW - solarKw;

  let batteryDischargeKw = 0;
  if (f?.type === "grid_outage") batteryDischargeKw = demandKw - solarKw;
  else if (f?.mitigated && f.type === "cloud_cover") batteryDischargeKw = solarGap;
  else if (f?.mitigated && f.type === "heatwave") batteryDischargeKw = 200;

  const gridImportKw = f?.type === "grid_outage" ? 0 : demandKw - solarKw - batteryDischargeKw;
  const socPct = batteryDischargeKw > 0 ? 79 : 82;

  const flows: PowerFlow[] = [
    { from: "solar", to: "bus", kw: solarKw },
    { from: "battery", to: "bus", kw: batteryDischargeKw },
    { from: "grid", to: "bus", kw: gridImportKw },
    ...zones.map((z) => ({ from: "bus", to: z.id, kw: z.demandKw })),
  ];

  const trendOf = (now: number, normal: number): Trend => (now > normal + 5 ? "up" : now < normal - 5 ? "down" : "flat");

  return {
    timestamp: now.toISOString(),
    mode,
    demandKw,
    solarKw,
    gridImportKw,
    battery: { socPct, powerKw: -batteryDischargeKw, capacityKwh: BATTERY_CAPACITY_KWH },
    costTodayInr: 41_250,
    baselineCostTodayInr: 49_900,
    tariff: tariffAt(17),
    trends: {
      demand: f ? trendOf(demandKw, 1240) : "up",
      solar: "down",
      battery: batteryDischargeKw > 0 ? "down" : "flat",
      grid: f ? trendOf(gridImportKw, 930) : "up",
      cost: "up",
    },
    zones,
    flows,
    activeFault,
  };
}

export function startFault(req: FaultRequest): ActiveFault {
  incidentCounter += 1;
  if (activeFault) lastIncident[activeFault.type] = activeFault.incidentId;
  runCounts[req.type] = (runCounts[req.type] ?? 0) + 1;
  mode = "ai";
  outageHostelLevel = 0.6;
  activeFault = {
    ...req,
    targetZoneId: req.type === "line_failure" ? (req.targetZoneId ?? DEFAULT_LINE_FAULT_ZONE) : req.targetZoneId,
    incidentId: `INC-${incidentCounter}`,
    startedAt: simNow().toISOString(),
    mitigated: false,
  };
  return activeFault;
}

/** Applies the agents' plan to the grid. */
export function mitigateFault() {
  if (activeFault) activeFault = { ...activeFault, mitigated: true };
}

/** Operator response to a paused high-impact action (grid outage). */
export function applyApproval(decision: "approve" | "modify" | "reject", hostelLevel?: number) {
  if (decision === "modify" && hostelLevel) outageHostelLevel = hostelLevel;
  if (decision === "reject") {
    // Safe fallback rules take over: hostels at a fixed 50%.
    outageHostelLevel = 0.5;
    mode = "fallback";
  }
  mitigateFault();
}

export function clearFault() {
  if (activeFault) lastIncident[activeFault.type] = activeFault.incidentId;
  activeFault = null;
  mode = "ai";
}

export const currentFault = () => activeFault;
/** Run number of the active scenario and the incident id of its previous run. */
export const runInfo = (type: FaultType) => ({ run: runCounts[type] ?? 1, previousIncident: lastIncident[type] });
