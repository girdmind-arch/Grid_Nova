// Resilience Autopilot: many versions of one outage, many plans, three recommendations.
// Mirrors backend/gridnova/autopilot.py. Everything here is a simulation.

export type PlanKey = "cheapest" | "safest" | "balanced";

export interface AutopilotRequest {
  heatSeverity: number;
  solarPct: number;
  /** Forecast outage start, hours since midnight (e.g. 14.5 = 14:30). */
  outageStart: number;
  outageHours: number;
  startSoc: number;
  runs: number;
  floorPct?: number;
  /** Buildings to keep at full power, besides the labs (always protected). */
  protect: string[];
  seed?: number;
}

export interface PlanMetrics {
  criticalUptimePct: number;
  criticalUptimeP10: number;
  /** Runs in which every protected building kept full power the whole time. */
  protectedRuns: number;
  interruptionMin: number;
  /** Minutes from the grid returning to every building back at full power. */
  recoveryMin: number;
  costInr: number;
  reserveP10Pct: number;
  reserveMeanPct: number;
  /** 0-100: how evenly cuts were shared among unprotected buildings (Jain's index). */
  fairness: number;
  /** Share of energy unprotected buildings asked for during the outage that they got. */
  servedPct: number;
  unservedKwh: number;
}

export interface GuardrailCheck {
  id: string;
  ok: boolean;
  text: string;
}

export interface PlanResult {
  key: PlanKey | "baseline";
  id: string;
  title: string;
  actions: string[];
  metrics: PlanMetrics;
  zones: { id: string; name: string; servedPct: number; protected: boolean }[];
  checks: GuardrailCheck[];
  passes: boolean;
  /** Other recommendations that turned out to be the same plan. */
  sameAs?: PlanKey[];
}

export interface CandidatePoint {
  id: string;
  style: "fair" | "ladder";
  costInr: number;
  servedPct: number;
  protectedRuns: number;
  fairness: number;
  reserveP10Pct: number;
  passes: boolean;
}

export interface ReplayPoint {
  soc: number;
  servedKw: number;
  /** Every protected building at full power at this moment. */
  ok: boolean;
}

export interface AutopilotStudy {
  studyId: string;
  label: "Simulation";
  scenario: Required<Omit<AutopilotRequest, "seed">> & { seed: number };
  variants: {
    demandPct: [number, number];
    solarPct: [number, number];
    outageStart: [string, string];
    outageHours: [number, number];
    startSoc: [number, number];
  };
  stats: { plans: number; runs: number; twinRuns: number; elapsedMs: number; feasible: number; stepMin: number };
  anyFeasible: boolean;
  candidates: CandidatePoint[];
  recommended: Record<PlanKey, PlanResult>;
  baseline: PlanResult;
  replay: {
    run: number;
    hours: number[];
    outageFrom: number;
    outageTo: number;
    demandKw: number[];
    solarKw: number[];
    plans: Record<PlanKey | "baseline", ReplayPoint[]>;
  };
  assumptions: string[];
}
