// The service layer: the ONLY place pages and components get data from.
//
// Each function has the signature the real FastAPI backend will use. Today they
// return mock data (marked // MOCK:). When VITE_API_URL is set, they call the
// backend instead. Endpoint paths are the proposed contract; adjust them here
// in one place if the backend team picks different ones.

import type { CampusLocation, ControlMode, Environment, FaultRequest, FaultResult, Forecast, GridState } from "@/types/grid";
import type { Agent, ApprovalResponse, ControlModeAck, ControlState, Decision, GoalAck, LearningReport, WhatIfSettings, GuardrailRule, IncidentMemory, Results, ScenarioRunHistory } from "@/types/agents";
import { ServiceError, USE_MOCKS, mockDelay, request } from "./api";
import { applyApproval, buildGridState, clearFault, currentFault, mitigateFault, runInfo, startFault } from "./mock/state";
import { buildForecast } from "./mock/forecast";
import { DECISIONS, LEARNING, SCENARIO_DECISIONS } from "./mock/agents";
import { MEMORY } from "./mock/memory";
import { AGENTS, GUARDRAILS } from "./mock/agentRoster";
import { RESULTS, RUN_HISTORY } from "./mock/results";
import { LEARNING_SNAPSHOT } from "./mock/learning";
import { simNow, syncSimClock } from "@/utils/simTime";
import type { DataSource, HardwareState } from "@/types/hardware";

// Several views ask for the grid at the same moment (top bar, page, 3D view): share one request.
let gridInFlight: Promise<GridState> | null = null;
/** After a change to the grid, the next read must not reuse a request started before it. */
const freshGrid = () => {
  gridInFlight = null;
};

/** Current grid snapshot: sources, battery, zones, flows, cost. */
export async function getGridState(): Promise<GridState> {
  if (!USE_MOCKS) {
    if (gridInFlight) return gridInFlight;
    gridInFlight = request<GridState>("/api/grid/state")
      .then((state) => {
        syncSimClock(state.timestamp, state.environment?.speed ?? 1);
        return state;
      })
      .finally(() => {
        gridInFlight = null;
      });
    return gridInFlight;
  }
  // MOCK: consistent snapshot from the in-browser demo campus.
  await mockDelay(300);
  return buildGridState(simNow());
}

/** Forecaster output for the next hours, plus notable upcoming events. */
export async function getForecast(): Promise<Forecast> {
  if (!USE_MOCKS) return request<Forecast>("/api/forecast");
  // MOCK: fixed 12-hour forecast for a hot May evening.
  await mockDelay(350);
  return buildForecast();
}

/** Starts a scenario (cloud cover, heatwave, line failure, grid outage). */
export async function injectFault(req: FaultRequest): Promise<FaultResult> {
  if (!USE_MOCKS) return request<FaultResult>("/api/scenarios/inject", { method: "POST", body: JSON.stringify(req) }).finally(freshGrid);
  // MOCK: flips the in-memory state; agents do not really run.
  await mockDelay(250);
  const fault = startFault(req);
  return { incidentId: fault.incidentId, startedAt: fault.startedAt, message: "Scenario started." };
}

/** Clears the active scenario (used by the Scenarios page and replay). */
export async function clearScenario(): Promise<void> {
  if (!USE_MOCKS) return request<void>("/api/scenarios/clear", { method: "POST" }).finally(freshGrid);
  // MOCK: resets the in-memory fault.
  await mockDelay(150);
  clearFault();
}

// MOCK: the pre-written texts describe severity 3; rewrite the numbers so they
// match the severity the operator picked (same formulas as mock/state.ts).
function withSeverity<T>(template: T, type: FaultRequest["type"], severity: number): T {
  let json = JSON.stringify(template);
  if (type === "cloud_cover") json = json.replaceAll("140 kW", `${Math.round(310 * 0.15 * severity)} kW`);
  if (type === "heatwave") json = json.replaceAll("up 12%", `up ${4 * severity}%`);
  return JSON.parse(json) as T;
}

/**
 * Asks the Orchestrator to run one observe→plan→act cycle and return its decision.
 * High-impact decisions come back with approval.status "pending" and are NOT
 * applied until respondToApproval() is called.
 */
export async function runOrchestratorStep(): Promise<Decision> {
  if (!USE_MOCKS) return request<Decision>("/api/agents/orchestrator/step", { method: "POST" });
  // MOCK: returns a pre-written decision for the active scenario. No AI is called.
  // Replays respond faster and cite the lesson from the previous run.
  const fault = currentFault();
  if (!fault) {
    await mockDelay(900);
    return DECISIONS[0];
  }
  const { run, previousIncident } = runInfo(fault.type);
  const learning = LEARNING[fault.type];
  const runIndex = Math.min(run, 3) - 1;
  await mockDelay([2600, 1900, 1300][runIndex]);

  const template = withSeverity(SCENARIO_DECISIONS[fault.type], fault.type, fault.severity);
  const startedAt = simNow().toISOString();
  const needsApproval = template.approval?.status === "pending";
  if (!needsApproval) mitigateFault();

  const replay = run > 1 && previousIncident;
  const severityFactor = 0.7 + 0.1 * fault.severity; // severity 3 = 1.0
  const recoveryMin = Math.round(learning.recoveryByRun[runIndex] * severityFactor * 10) / 10;

  return {
    ...template,
    id: `dec-${fault.incidentId}`,
    incidentId: fault.incidentId,
    startedAt,
    title: replay ? `${template.title} (run ${run})` : template.title,
    usedMemory: replay ? { incidentId: previousIncident, summary: `Run ${run - 1}: ${learning.lesson}` } : template.usedMemory,
    outcome: {
      run,
      recoveryMin,
      baselineMin: Math.round(learning.baselineMin * severityFactor * 10) / 10,
      lessonApplied: replay ? learning.lesson : undefined,
      lessonLearned: replay ? undefined : learning.lesson,
    },
    steps: template.steps
      // Until approved, the "act" and "result" steps have not happened yet.
      .filter((s) => !needsApproval || (s.kind !== "act" && s.kind !== "result"))
      .map((s) =>
        replay && s.kind === "reason"
          ? { ...s, at: startedAt, detail: `Lesson applied from ${previousIncident}: ${learning.lesson}` }
          : { ...s, at: startedAt },
      ),
  };
}

// MOCK: battery runtime by hostel level in a grid outage (2 MWh, 79% → 20% floor).
const BATTERY_RUNTIME: Record<number, string> = { 50: "~1 h 50 min", 60: "~1 h 40 min", 70: "~1 h 35 min" };

/** Operator's answer to a paused high-impact decision. Returns the updated decision. */
export async function respondToApproval(decision: Decision, response: ApprovalResponse): Promise<Decision> {
  if (!USE_MOCKS)
    return request<Decision>(`/api/agents/decisions/${decision.id}/approval`, { method: "POST", body: JSON.stringify(response) }).finally(freshGrid);
  // MOCK: applies the response to the in-memory grid and completes the trace.
  await mockDelay(500);
  const fault = currentFault();
  const level = response.decision === "modify" ? Number(response.optionId) : undefined;
  applyApproval(response.decision, level);

  const at = simNow().toISOString();
  const template = fault ? SCENARIO_DECISIONS[fault.type] : undefined;
  const pct = Math.round((level ?? (response.decision === "reject" ? 0.5 : 0.6)) * 100);
  const note =
    response.decision === "approve"
      ? "Approved by Duty Operator."
      : response.decision === "modify"
        ? `Modified by Duty Operator: hostels at ${pct}%.`
        : "Rejected by Duty Operator. Safe rule-based control is active (hostels at 50%).";
  const status = response.decision === "approve" ? "approved" : response.decision === "modify" ? "modified" : "rejected";

  const finalSteps =
    response.decision === "reject"
      ? [
          { id: "s5", kind: "act" as const, agent: "guardrail" as const, at, summary: "Fallback rules applied: hostels at a fixed 50%." },
          { id: "s6", kind: "result" as const, agent: "critic" as const, at, summary: "All zones powered on safe rules. AI control can be resumed any time." },
        ]
      : (template?.steps ?? [])
          .filter((s) => s.kind === "act" || s.kind === "result")
          .map((s) => ({
            ...s,
            at,
            summary:
              s.kind === "act"
                ? `Hostels restored at ${pct}%; battery powering the campus.`
                : `All zones powered. Battery lasts ${BATTERY_RUNTIME[pct] ?? "~1 h 40 min"} at this load.`,
          }));

  return {
    ...decision,
    steps: [...decision.steps, ...finalSteps],
    approval: decision.approval && {
      ...decision.approval,
      status,
      response: { optionId: response.decision === "modify" ? response.optionId : undefined, note, at },
    },
  };
}

/** Recent decisions with their full thought trace, newest first. */
export async function getThoughtTrace(): Promise<Decision[]> {
  if (!USE_MOCKS) return request<Decision[]>("/api/agents/trace");
  // MOCK: pre-written decisions.
  await mockDelay(400);
  return DECISIONS;
}

/** Past incidents and the Critic's lessons learned. */
export async function getIncidentMemory(): Promise<IncidentMemory> {
  if (!USE_MOCKS) return request<IncidentMemory>("/api/memory");
  // MOCK: four past incidents and three lessons.
  await mockDelay(350);
  return MEMORY;
}

/** GridNova vs. no-AI baseline evaluation. */
export async function getResults(): Promise<Results> {
  if (!USE_MOCKS) return request<Results>("/api/results");
  // MOCK: evaluation numbers from the simulated campus.
  await mockDelay(350);
  return RESULTS;
}

/** Re-runs the five-day evaluation with different campus settings. */
export async function runWhatIf(settings: WhatIfSettings): Promise<Results> {
  if (!USE_MOCKS) return request<Results>("/api/results/whatif", { method: "POST", body: JSON.stringify(settings) });
  // MOCK: the offline demo cannot simulate; it returns the standard results.
  await mockDelay(400);
  throw new ServiceError("What-if needs the live backend. This copy runs on demo data.");
}

/** Current mode and goal on the backend (used when the app opens). */
export async function getControl(): Promise<ControlState | null> {
  if (!USE_MOCKS) return request<ControlState>("/api/control");
  // MOCK: nothing to restore; the app keeps its defaults.
  return null;
}

/** Places in India matching a search (city, town or campus). */
export async function searchLocations(query: string): Promise<{ source: string; results: CampusLocation[] }> {
  if (!USE_MOCKS) return request(`/api/locations/search?q=${encodeURIComponent(query)}`);
  // MOCK: the offline demo has one fixed campus.
  return { source: "built-in", results: [] };
}

/** Where the campus is, and its state's tariff. */
export async function getLocation(): Promise<CampusLocation | null> {
  if (!USE_MOCKS) return request<CampusLocation>("/api/location");
  // MOCK: fixed demo campus.
  return null;
}

/** Moves the campus: new weather feed, the state's tariff, today re-simulated. */
export async function setLocation(place: Pick<CampusLocation, "name" | "state" | "lat" | "lon">): Promise<CampusLocation> {
  if (!USE_MOCKS) return request<CampusLocation>("/api/location", { method: "POST", body: JSON.stringify(place) });
  // MOCK: not available offline.
  throw new ServiceError("Changing the location needs the live backend. This copy runs on demo data.");
}

/** Simulation clock: live (real time and weather) or a sped-up demo evening. */
export async function setSimulation(clock: Environment["clock"], speed: number): Promise<Environment> {
  if (!USE_MOCKS) return request<Environment>("/api/sim", { method: "POST", body: JSON.stringify({ clock, speed }) });
  // MOCK: the offline demo has a fixed clock.
  await mockDelay(200);
  throw new ServiceError("The simulation clock needs the live backend. This copy runs on demo data.");
}

/** Recovery time for every evaluation run of each scenario (run 1, 2, 3…). */
export async function getRunHistory(): Promise<ScenarioRunHistory[]> {
  if (!USE_MOCKS) return request<ScenarioRunHistory[]>("/api/results/runs");
  // MOCK: three evaluation runs per scenario from the simulated campus.
  await mockDelay(300);
  return RUN_HISTORY;
}

/** Switches who is in control: AI agents, fallback rules, or a human operator. */
export async function setControlMode(mode: ControlMode): Promise<ControlModeAck> {
  if (!USE_MOCKS) return request<ControlModeAck>("/api/control/mode", { method: "POST", body: JSON.stringify({ mode }) });
  // MOCK: acknowledges the switch; nothing on a real grid changes.
  await mockDelay(400);
  const message: Record<ControlMode, string> = {
    ai: "Agents are planning and acting again, within the guardrails.",
    fallback: "Fixed safety rules are running the grid. Agents keep forecasting but do not act.",
    manual: "Agents have stopped acting. Guardrails still block unsafe commands.",
  };
  return { mode, changedAt: simNow().toISOString(), message: message[mode] };
}

/** Sets the operator's goal in plain English; the Orchestrator restates how it understood it. */
export async function setGoal(goal: string): Promise<GoalAck> {
  if (!USE_MOCKS) return request<GoalAck>("/api/goal", { method: "POST", body: JSON.stringify({ goal }) });
  // MOCK: echoes the goal with a canned interpretation.
  await mockDelay(600);
  return {
    goal,
    interpretation: `Understood. I'll prioritise "${goal}" while labs keep full power and the battery stays between 20% and 90%.`,
    acceptedAt: simNow().toISOString(),
  };
}

/** The seven agents, their roles and tools. */
export async function getAgents(): Promise<Agent[]> {
  if (!USE_MOCKS) return request<Agent[]>("/api/agents");
  // MOCK: static roster; live status comes from the thought trace.
  await mockDelay(300);
  return AGENTS;
}

/** Hard rules the agents cannot override. */
export async function getGuardrails(): Promise<GuardrailRule[]> {
  if (!USE_MOCKS) return request<GuardrailRule[]>("/api/guardrails");
  // MOCK: fixed rule set.
  await mockDelay(200);
  return GUARDRAILS;
}

/** What the agents learned: trained models with their held-out scores, live learning, the Critic's memory. */
export async function getLearning(): Promise<LearningReport> {
  if (!USE_MOCKS) return request<LearningReport>("/api/learning");
  // MOCK: snapshot of the last real training run (no live learning without the backend).
  await mockDelay(250);
  return LEARNING_SNAPSHOT;
}

/** Answers a question using the live simulated-campus snapshot. */
export async function askGridNova(messages: { role: "user" | "assistant"; content: string }[]): Promise<string> {
  if (USE_MOCKS) throw new ServiceError("Chat needs the live GridNova backend.");
  const result = await request<{ reply: string }>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
  return result.reply;
}

export { ServiceError, USE_MOCKS } from "./api";


// ---------- Hardware demo (tabletop ESP32 rig) ----------
// The rig is separate from the simulated campus. Its readings are volts and amps; they are never
// returned by getGridState() and never shown as campus kW/kWh.

// MOCK: demo data has no backend, so there is no rig. Nothing here is pretending to be a device.
const NO_RIG: HardwareState = {
  dataSource: "simulation",
  campusDataSource: "simulation",
  mode: "simulation",
  configured: false,
  armed: false,
  armedUntil: null,
  armedBy: null,
  estop: { active: false, reason: null, resetPending: false },
  device: {
    id: null,
    status: "never_seen",
    ageS: null,
    firmware: null,
    source: null,
    loads: {},
    readings: { adapter: null, battery: null },
    health: null,
    warnings: [],
    stateOfCharge: { status: "unknown", socPct: null, reason: "No rig is connected on demo data." },
  },
  commands: [],
  capabilities: { scenarios: {}, loads: [] },
};

export async function getHardwareState(): Promise<HardwareState> {
  if (!USE_MOCKS) return request<HardwareState>("/api/hardware/state");
  await mockDelay(150);
  return NO_RIG;
}

const hwPost = <T>(path: string, body?: unknown) => {
  if (USE_MOCKS) throw new ServiceError("The hardware demo needs the live backend.");
  return request<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};

export const setHardwareMode = (mode: DataSource) => hwPost<HardwareState>("/api/hardware/mode", { mode });
export const armHardware = (minutes = 10) => hwPost<HardwareState>("/api/hardware/arm", { minutes });
export const disarmHardware = () => hwPost<HardwareState>("/api/hardware/disarm");
export const emergencyStopHardware = () => hwPost<HardwareState>("/api/hardware/estop");
export const resetEmergencyStop = () => hwPost<HardwareState>("/api/hardware/estop/reset");
