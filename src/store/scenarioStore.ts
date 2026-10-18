import { create } from "zustand";
import type { FaultRequest, FaultType, GridState } from "@/types/grid";
import type { HardwareDispatch } from "@/types/hardware";
import type { ApprovalResponse, Decision, Incident, Lesson, ScenarioOutcome } from "@/types/agents";
import { USE_MOCKS, clearScenario, getGridState, getThoughtTrace, injectFault, respondToApproval, runOrchestratorStep } from "@/services";
import { play } from "@/utils/sound";
import { useAppStore } from "./appStore";
import { toast } from "./toastStore";
import { VIEW_ONLY_MESSAGE, canActNow } from "./authStore";

// The live loop shown on the Control Room (and later the Scenarios page):
//   scenario fires → grid reacts → Orchestrator thinks → (approval?) → stable.
// All data still comes from the service layer; this store only orchestrates it.

export type ScenarioPhase = "idle" | "responding" | "awaiting-approval" | "stable";

/** Where a running scenario is in its story: the fault has just hit, or the agents are talking. */
export type ScenarioStage = "fault" | "agents" | null;
interface ActiveScenario extends FaultRequest {
  incidentId: string;
  /** Real-time ms, used for the recovery timer. */
  startedAtMs: number;
  stabilisedAtMs: number | null;
}

interface ScenarioState {
  phase: ScenarioPhase;
  active: ActiveScenario | null;
  /** Thought trace, newest first. */
  decisions: Decision[];
  traceStatus: "loading" | "ready" | "error";
  /** Bumped whenever the grid changes, so views reload getGridState(). */
  gridVersion: number;
  /** Bumped every few seconds with the live backend, so live views refresh. */
  liveTick: number;
  /** True while the Orchestrator is thinking (shows ThinkingSteps). */
  thinking: boolean;
  /** Outcome of every run this session, per scenario type (oldest first). */
  history: Partial<Record<FaultType, ScenarioOutcome[]>>;
  /** Settings of the last scenario, used by "Replay same scenario". */
  lastRequest: FaultRequest | null;
  /** Incidents and lessons created during this session (shown on Memory). */
  sessionIncidents: Incident[];
  sessionLessons: Lesson[];
  /** Story beat of the running scenario (fault first, then the agents). */
  stage: ScenarioStage;
  /** The decision being played back step by step on the Scenarios page. */
  liveDecision: Decision | null;
  /** How many of liveDecision's steps have been shown so far. */
  revealed: number;
  /** Grid as it was right after the fault hit, shown until the agents act. */
  faultSnapshot: GridState | null;
  /** Whether the tabletop rig was involved in the running scenario (live backend only). */
  hardware: HardwareDispatch | null;

  loadTrace: () => Promise<void>;
  /** Live backend heartbeat: refresh the grid and the agents' trace. */
  pulse: () => Promise<void>;
  run: (type: FaultType, opts?: Partial<Omit<FaultRequest, "type">>) => Promise<void>;
  respond: (decision: Decision, response: ApprovalResponse) => Promise<void>;
  end: () => Promise<void>;
  replay: () => Promise<void>;
  /** Clears any running scenario, then runs this one. */
  startFresh: (type: FaultType, opts?: Partial<Omit<FaultRequest, "type">>) => Promise<void>;
  /** Presentation mode: runs the scenarios back to back for a live pitch. */
  touring: boolean;
  startTour: () => Promise<void>;
  stopTour: () => void;
}

const DEFAULTS = { severity: 3, durationMin: 30 };

/** Turns a scenario decision into a memory entry (what happened, what was done, result). */
function incidentFrom(type: FaultType, d: Decision): Incident {
  const act = d.steps.find((s) => s.kind === "act")?.summary;
  const result = d.steps.find((s) => s.kind === "result")?.summary;
  return {
    id: d.incidentId ?? d.id,
    occurredAt: d.startedAt,
    type,
    title: d.title,
    cause: d.trigger,
    action: act ?? `Proposed: ${d.plans.find((p) => p.id === d.chosenPlanId)?.summary ?? ""} Waiting for operator approval.`,
    outcome: result ?? "Pending operator approval.",
    recoveryMin: d.outcome?.recoveryMin ?? 0,
  };
}

/** Adds a new lesson (first run) or counts a reuse (replay). */
function updateLessons(lessons: Lesson[], d: Decision): Lesson[] {
  const o = d.outcome;
  if (!o || !d.incidentId) return lessons;
  if (o.lessonLearned && !lessons.some((l) => l.note === o.lessonLearned)) {
    return [{ id: `L-${d.incidentId}`, incidentId: d.incidentId, note: o.lessonLearned, appliedCount: 0 }, ...lessons];
  }
  if (o.lessonApplied) {
    return lessons.map((l) => (l.note === o.lessonApplied ? { ...l, appliedCount: l.appliedCount + 1 } : l));
  }
  return lessons;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  phase: "idle",
  active: null,
  decisions: [],
  traceStatus: "loading",
  gridVersion: 0,
  liveTick: 0,
  thinking: false,
  history: {},
  lastRequest: null,
  sessionIncidents: [],
  sessionLessons: [],
  stage: null,
  liveDecision: null,
  revealed: 0,
  faultSnapshot: null,
  hardware: null,
  touring: false,

  loadTrace: async () => {
    if (get().decisions.length) return;
    set({ traceStatus: "loading" });
    try {
      set({ decisions: await getThoughtTrace(), traceStatus: "ready" });
    } catch {
      set({ traceStatus: "error" });
    }
  },

  pulse: async () => {
    if (USE_MOCKS) return;
    set((s) => ({ liveTick: s.liveTick + 1, gridVersion: s.gridVersion + 1 }));
    // The backend owns the trace: the agents re-plan on their own, so pick up new decisions.
    if (get().phase === "responding") return;
    try {
      const decisions = await getThoughtTrace();
      if (get().phase !== "responding") set({ decisions, traceStatus: "ready" });
    } catch {
      /* keep the last trace; the grid view shows the connection problem */
    }
  },

  run: async (type, opts) => {
    if (!canActNow()) return void toast(VIEW_ONLY_MESSAGE);
    if (get().phase === "responding" || get().phase === "awaiting-approval") return;
    const req: FaultRequest = { type, ...DEFAULTS, ...opts };
    const token = ++runToken;
    set({ lastRequest: req });
    try {
      const fault = await injectFault(req);
      // Freeze the broken grid so the fault is visible before the agents fix it.
      const snapshot = await getGridState().catch(() => null);
      if (token !== runToken) return;
      set((s) => ({
        phase: "responding",
        stage: "fault",
        thinking: true,
        liveDecision: null,
        revealed: 0,
        faultSnapshot: snapshot,
        hardware: fault.hardware ?? null,
        active: { ...req, incidentId: fault.incidentId, startedAtMs: Date.now(), stabilisedAtMs: null },
        gridVersion: s.gridVersion + 1,
      }));
      play("alarm");
      // Scenarios demo the agents, so they take control back from Manual / Fallback.
      if (useAppStore.getState().mode !== "ai") {
        useAppStore.getState().setMode("ai");
        toast({ title: "AI Control is back on", description: "Scenarios show the agents responding, so they take over for this run.", tone: "ai" });
      }

      // The agents start thinking straight away; the fault stays on screen for a moment.
      const [decision] = await Promise.all([runOrchestratorStep(), sleep(FAULT_HOLD_MS)]);
      if (token !== runToken) return;
      const run = decision.outcome?.run ?? 1;
      set({ stage: "agents", liveDecision: decision, revealed: 0 });
      await revealSteps(token, decision, 0, stepMsFor(run), set);
      if (token !== runToken) return;

      const needsApproval = decision.approval?.status === "pending";
      const outcome = decision.outcome;
      set((s) => ({
        thinking: false,
        faultSnapshot: null,
        decisions: [decision, ...s.decisions.filter((d) => d.id !== decision.id)],
        history: outcome ? { ...s.history, [type]: [...(s.history[type] ?? []), outcome] } : s.history,
        sessionIncidents: [incidentFrom(type, decision), ...s.sessionIncidents],
        sessionLessons: updateLessons(s.sessionLessons, decision),
        phase: needsApproval ? "awaiting-approval" : "stable",
        active: s.active && { ...s.active, stabilisedAtMs: needsApproval ? null : Date.now() },
        gridVersion: s.gridVersion + 1,
      }));
      if (needsApproval) {
        play("attention");
        toast({ title: "Approval needed", description: decision.approval!.request, tone: "warning" });
      } else play("resolve");
    } catch {
      if (token !== runToken) return;
      set({ thinking: false, phase: "idle", stage: null, faultSnapshot: null, liveDecision: null });
      useAppStore.getState().setMode("fallback");
      toast({ title: "The AI service is unreachable.", description: "Safe rule-based control is active.", tone: "warning" });
    }
  },

  respond: async (decision, response) => {
    if (!canActNow()) return void toast(VIEW_ONLY_MESSAGE);
    const token = runToken;
    const updated = await respondToApproval(decision, response);
    if (updated.hardware) set({ hardware: updated.hardware });
    const live = get().liveDecision?.id === updated.id;
    if (live) {
      // Play the operator's choice and the agents' follow-up like the rest of the run.
      set({ liveDecision: updated, thinking: true });
      await revealSteps(token, updated, get().revealed, stepMsFor(updated.outcome?.run ?? 1), set);
    }
    set((s) => ({
      thinking: false,
      decisions: s.decisions.map((d) => (d.id === updated.id ? updated : d)),
      sessionIncidents: s.sessionIncidents.map((i) =>
        i.id === updated.incidentId && s.active ? incidentFrom(s.active.type, updated) : i,
      ),
      phase: "stable",
      active: s.active && { ...s.active, stabilisedAtMs: Date.now() },
      gridVersion: s.gridVersion + 1,
    }));
    if (response.decision === "reject") useAppStore.getState().setMode("fallback");
    play("resolve");
    toast({
      title: response.decision === "reject" ? "Plan rejected" : "Plan applied",
      description: updated.approval?.response?.note,
      tone: response.decision === "reject" ? "warning" : "success",
    });
  },

  end: async () => {
    runToken++;
    tourToken++;
    set({ touring: false });
    await clearScenario();
    set((s) => ({ ...IDLE, gridVersion: s.gridVersion + 1 }));
    useAppStore.getState().setMode("ai");
    toast({ title: "Scenario ended", description: "The grid is back to normal operation.", tone: "neutral" });
  },

  replay: async () => {
    const req = get().lastRequest;
    if (!req) return;
    // Back to normal first, then the same fault again. The agents remember the last run.
    await clearScenario();
    set((s) => ({ ...IDLE, gridVersion: s.gridVersion + 1 }));
    await get().run(req.type, req);
  },

  startFresh: async (type, opts) => {
    if (get().phase === "responding") return;
    if (get().active) {
      await clearScenario();
      set((s) => ({ ...IDLE, gridVersion: s.gridVersion + 1 }));
    }
    await get().run(type, opts);
  },

  startTour: async () => {
    if (!canActNow()) return void toast(VIEW_ONLY_MESSAGE);
    if (get().phase === "responding") return;
    const token = ++tourToken;
    set({ touring: true });
    toast({ title: "Presentation mode", description: "Running every scenario back to back. Stop any time.", tone: "ai" });
    for (const [i, step] of TOUR.entries()) {
      if (token !== tourToken) return;
      if (i > 0) await sleep(TOUR_GAP_MS);
      if (token !== tourToken) return;
      await get().startFresh(step.type, { severity: step.severity, durationMin: 30 });
      if (get().phase === "awaiting-approval") break; // the operator takes over from here
    }
    if (token !== tourToken) return;
    set({ touring: false });
    if (get().phase === "awaiting-approval")
      toast({ title: "Your turn", description: "Approve, modify or reject the agents' outage plan.", tone: "warning" });
  },

  stopTour: () => {
    tourToken++;
    set({ touring: false });
  },
}));

/** Presentation order: easy wins first, a replay to show learning, then the outage that needs a human. */
const TOUR: { type: FaultType; severity: number }[] = [
  { type: "cloud_cover", severity: 3 },
  { type: "heatwave", severity: 4 },
  { type: "line_failure", severity: 3 },
  { type: "line_failure", severity: 3 },
  { type: "grid_outage", severity: 3 },
];
/** Time to look at each outcome (the recovery race runs for 5 s). */
const TOUR_GAP_MS = 7000;
let tourToken = 0;

// ---------- playback helpers ----------

const IDLE = { phase: "idle" as const, active: null, thinking: false, stage: null, liveDecision: null, revealed: 0, faultSnapshot: null, hardware: null };

/** Bumped by every new run or end, so an older playback stops quietly. */
let runToken = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** How long the fault is on screen before the agents' first message. */
const FAULT_HOLD_MS = 2400;

/** Replays are played faster: the agents remember the last run. */
function stepMsFor(run: number) {
  const ms = [1500, 1050, 750][Math.min(run, 3) - 1];
  return reducedMotion() ? Math.round(ms / 2) : ms;
}

type Set = (fn: Partial<ScenarioState> | ((s: ScenarioState) => Partial<ScenarioState>)) => void;

/** Shows the decision's steps one at a time. The real grid replaces the fault snapshot once the agents act. */
async function revealSteps(token: number, d: Decision, from: number, stepMs: number, set: Set) {
  for (let i = from; i < d.steps.length; i++) {
    await sleep(i === from ? Math.round(stepMs * 0.6) : stepMs);
    if (token !== runToken) return;
    const step = d.steps[i];
    const acted = step.kind === "act";
    set((s) => ({
      revealed: i + 1,
      ...(acted ? { faultSnapshot: null, gridVersion: s.gridVersion + 1 } : {}),
    }));
    play("step");
  }
  // Let the last message sit for a beat before the outcome appears.
  await sleep(Math.round(stepMs * 0.5));
}
