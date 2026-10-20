import type { ControlMode, FaultType, ISODate } from "./grid";

export type AgentId =
  | "orchestrator"
  | "forecaster"
  | "zone"
  | "planner"
  | "fault"
  | "critic"
  | "guardrail";

export type AgentStatus = "idle" | "thinking" | "acting" | "waiting" | "paused";

export interface Agent {
  id: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  lastAction: string;
  tools: string[];
}

/** A hard rule the agents cannot override. */
export interface GuardrailRule {
  id: string;
  rule: string;
  why: string;
}

// ---------- Thought trace ----------
export type TraceStepKind = "observe" | "reason" | "plan" | "safety" | "act" | "result";

export interface TraceStep {
  id: string;
  kind: TraceStepKind;
  agent: AgentId;
  at: ISODate;
  summary: string;
  detail?: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface Plan {
  id: "A" | "B";
  title: string;
  summary: string;
  costInr: number;
  risk: RiskLevel;
  comfortPct: number; // 0–100, how much of normal comfort is kept
  actions: string[];
}

export interface Decision {
  id: string;
  /** Set on the answer to an approval when the tabletop rig was involved. */
  hardware?: import("./hardware").HardwareDispatch;
  startedAt: ISODate;
  title: string;
  trigger: string;
  steps: TraceStep[];
  plans: [Plan, Plan];
  chosenPlanId: Plan["id"];
  chosenReason: string;
  /** Plain-language answer to "Why did you do that?" */
  explanation: string;
  usedMemory?: { incidentId: string; summary: string };
  /** Set when this decision responded to a scenario / incident. */
  incidentId?: string;
  /** Scenario outcome measured in the digital twin (simulated minutes). */
  outcome?: ScenarioOutcome;
  /** High-impact decisions pause for operator approval. */
  approval?: Approval;
  /** How the Planner found this plan: its search in the digital twin (live backend only). */
  search?: PlanSearch;
}

export interface PlanSearch {
  twinRuns: number;
  rounds: number;
  /** Plans the Guardrail ruled out. */
  rejected: number;
  /** Cost (₹) of the best safe plan after each search round. */
  bestByRound: number[];
  /** Incident whose remembered plan seeded the search (the Critic's memory). */
  seededFrom: string | null;
  /** What the learned RL battery policy scored in the same search. */
  learnedPolicyCostInr?: number;
}

export interface ScenarioOutcome {
  /** Which time this scenario type has been run (1, 2, 3…). */
  run: number;
  /** Simulated minutes from fault to a stable grid. */
  recoveryMin: number;
  /** Same scenario with no AI (rule-free baseline). */
  baselineMin: number;
  /** Lesson from an earlier run that made this one faster. */
  lessonApplied?: string;
  /** Lesson the Critic wrote after this run (first run of a scenario). */
  lessonLearned?: string;
  /** Where the minutes went: sensors, the twin search, switching. */
  breakdown?: { detectMin: number; analyseMin: number; actMin: number; twinRuns: number };
}

export type ApprovalStatus = "pending" | "approved" | "modified" | "rejected";

export interface Approval {
  status: ApprovalStatus;
  /** What the agent wants to do, in one line. */
  request: string;
  risk: string;
  /** Options the operator can pick from when choosing "Modify". */
  modifyOptions?: { id: string; label: string }[];
  /** Filled in once the operator responds. */
  response?: { optionId?: string; note: string; at: ISODate };
}

export type ApprovalResponse =
  | { decision: "approve" }
  | { decision: "modify"; optionId: string }
  | { decision: "reject" };

export interface ControlModeAck {
  mode: ControlMode;
  changedAt: ISODate;
  /** What changes now, in plain words. */
  message: string;
}

export interface GoalAck {
  goal: string;
  interpretation: string;
  acceptedAt: ISODate;
}

// ---------- Memory ----------
export interface Incident {
  id: string;
  occurredAt: ISODate;
  type: FaultType;
  title: string;
  cause: string;
  action: string;
  outcome: string;
  recoveryMin: number;
}

export interface Lesson {
  id: string;
  incidentId: string;
  note: string;
  appliedCount: number;
}

export interface IncidentMemory {
  incidents: Incident[];
  lessons: Lesson[];
}

// ---------- Results ----------
export interface ResultsSeriesPoint {
  label: string;
  gridnova: number;
  baseline: number;
}

export interface Results {
  dataNote: string;
  headline: {
    costSavedPct: number;
    peakReducedPct: number;
    recovery: { gridnovaMin: number; baselineMin: number };
  };
  cost: ResultsSeriesPoint[]; // INR per day
  peak: ResultsSeriesPoint[]; // kW per hour
  recovery: ResultsSeriesPoint[]; // minutes per scenario
  runs: { run: 1 | 2 | 3; recoveryMin: number; costSavedPct: number }[];
  /** The campus settings these results were simulated with. */
  settings?: WhatIfSettings;
}

/** What-if inputs for re-running the evaluation. */
export interface WhatIfSettings {
  batteryKwh: number;
  solarPct: number;
  /** ₹/kWh in the 18:00–22:00 peak (the campus state's rate by default). */
  peakRate: number;
  tempOffsetC: number;
}

/** Current control state, so a reloaded page shows what the backend is doing. */
export interface ControlState {
  mode: ControlMode;
  goal: string;
  interpretation: string;
}

/** Recovery time for every evaluation run of one scenario (Results, run-by-run view). */
export interface ScenarioRunHistory {
  type: FaultType;
  baselineMin: number;
  runs: { run: number; recoveryMin: number; lessonApplied?: string }[];
}

// ---------- What the agents learned (GET /api/learning) ----------
export interface LearningReport {
  trained: {
    trainedAt?: string;
    trainingSeconds?: number;
    forecaster?: {
      model: string;
      trainExamples: number;
      validationExamples: number;
      maeKw: number;
      mapePct: number;
      maeByHourAheadKw: number[];
      baselineMaeKw: { typicalDayProfile: number; sameAsNow: number };
    };
    planner?: {
      model: string;
      episodes: number;
      statesVisited: number;
      forecastNoisePct: number;
      curve: { episode: number; avgSavedInr: number; epsilon: number }[];
      evaluation: {
        days: number;
        avgNoAiInr: number;
        avgRulesInr: number;
        avgLearnedInr: number;
        learnedSavedVsNoAiPct: number;
        rulesSavedVsNoAiPct: number;
        learnedVsRulesInr: number;
        learnedBeatsRulesDays: number;
        minSocPct: number;
      };
    };
    scenarios?: {
      type: FaultType;
      baselineMin: number;
      runs: { run: number; recoveryMin: number; twinRuns: number; plan: string; costInr: number; lessonApplied?: string }[];
    }[];
  };
  live: {
    forecasterOnlineUpdates: number;
    forecasterLiveMaeKw: number | null;
    memories: { kind: string; source: string; note: string; recalled: number }[];
  };
  available: { forecaster: boolean; plannerPolicy: boolean };
}
