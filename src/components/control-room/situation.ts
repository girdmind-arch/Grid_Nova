// hi
import type { GridState } from "@/types/grid";
import type { Decision } from "@/types/agents";
import type { ScenarioPhase } from "@/store/scenarioStore";
import { istHour } from "@/utils/format";
import { SCENARIOS } from "@/components/scenarios/scenarioMeta";

/** Minutes until the 18:00 IST evening peak (0 if it has started). */
function minutesToPeak(now: Date) {
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const peak = new Date(ist);
  peak.setHours(18, 0, 0, 0);
  return Math.max(0, Math.round((peak.getTime() - ist.getTime()) / 60000));
}

/**
 * The hero sentence: the grid situation in plain English.
 * Kept short on purpose; numbers live in the stat strip (say each thing once).
 */
export function describeSituation(state: GridState, latest: Decision | undefined, phase: ScenarioPhase, now: Date) {
  const fault = state.activeFault;
  if (fault) {
    const what = SCENARIOS[fault.type].activeLabel;
    if (phase === "responding") return { headline: `${what}.`, detail: "Agents are testing a response in the digital twin." };
    if (phase === "awaiting-approval")
      return { headline: `${what}. A plan is ready.`, detail: "It is a high-impact action, so it is waiting for your approval." };
    if (latest?.approval?.status === "rejected")
      return { headline: `${what}. Safe rules are in control.`, detail: "You rejected the agents' plan. Fallback rules keep hostels at 50% until you resume AI control." };
    return {
      headline: `${what}. The grid is stable again.`,
      detail: latest?.approval?.response?.note ?? (latest ? `${latest.title}: ${latest.chosenReason}` : ""),
    };
  }

  const hour = istHour(now);
  const mins = minutesToPeak(now);
  const planLine = latest ? `Plan ${latest.chosenPlanId} is active: ${latest.plans.find((p) => p.id === latest.chosenPlanId)?.title.toLowerCase()}.` : "";
  if (hour < 18 && mins > 0) {
    return { headline: `Evening peak in ${mins} minutes. ${planLine}`, detail: "The battery will cover the peak instead of costly grid power." };
  }
  if (hour >= 18 && hour < 22) return { headline: `Evening peak is on until 22:00. ${planLine}`, detail: "The battery is covering part of the load." };
  return { headline: "Off-peak hours. The grid is calm.", detail: "GridNova is recharging the battery at the cheapest rate." };
}
