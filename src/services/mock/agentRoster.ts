// MOCK: the seven agents and the Guardrail's hard rules.
// Status and last action are overlaid live in the UI from the thought trace.

import type { Agent, GuardrailRule } from "@/types/agents";

export const AGENTS: Agent[] = [
  {
    id: "orchestrator",
    name: "Orchestrator",
    role: "Runs the decision loop, scores plans for your goal and explains every choice with the computed numbers.",
    status: "idle",
    lastAction: "Chose Plan B for the evening peak.",
    tools: ["read_grid_state", "ask_forecaster", "request_plans", "submit_to_guardrail", "dispatch_action", "explain"],
  },
  {
    id: "forecaster",
    name: "Forecaster",
    role: "A neural network trained on simulated campus history; predicts demand for the next 12 hours and keeps learning from the meters.",
    status: "idle",
    lastAction: "Forecast a 1,510 kW peak at 19:00 (±4%).",
    tools: ["learned_demand_forecast", "solar_forecast", "weather_feed", "learn_from_meters"],
  },
  {
    id: "zone",
    name: "Zone Agents",
    role: "One per building. Report load and how much can be safely reduced.",
    status: "idle",
    lastAction: "Hostels offered 1°C of pre-cooling flexibility.",
    tools: ["read_zone_meter", "set_hvac_setpoint", "report_flexibility"],
  },
  {
    id: "planner",
    name: "Planner / Simulator",
    role: "Invents plans by searching the available levers in the digital twin; one option is its own reinforcement-learning battery policy.",
    status: "idle",
    lastAction: "Searched 30 plans in the twin over the next 5 hours.",
    tools: ["cross_entropy_search", "simulate_in_twin", "rl_battery_policy", "compare_plans"],
  },
  {
    id: "fault",
    name: "Fault Responder",
    role: "Detects faults and isolates or reroutes power within seconds.",
    status: "idle",
    lastAction: "All feeders healthy. Last fault handled on 8 May.",
    tools: ["read_relays", "open_switch", "close_tie_switch"],
  },
  {
    id: "critic",
    name: "Critic",
    role: "Remembers which plan worked in which situation and seeds later searches with it.",
    status: "idle",
    lastAction: "Projected ₹4,180 saving tonight vs. baseline.",
    tools: ["score_outcome", "store_experience", "recall_similar_situation"],
  },
  {
    id: "guardrail",
    name: "Guardrail",
    role: "Checks every plan against hard rules before anything happens.",
    status: "idle",
    lastAction: "Approved Plan B: all rules pass.",
    tools: ["check_rules", "require_approval", "veto"],
  },
];

export const GUARDRAILS: GuardrailRule[] = [
  { id: "G1", rule: "Labs never lose power.", why: "Experiments and equipment cannot be interrupted." },
  { id: "G2", rule: "Battery stays between 20% and 90%.", why: "Protects battery life and keeps an emergency reserve." },
  { id: "G3", rule: "No feeder above 90% loading.", why: "Prevents overheating and cascading trips." },
  { id: "G4", rule: "Grid import stays under the 1,600 kW contract limit.", why: "Avoids penalty charges from the utility." },
  { id: "G5", rule: "Hostel rooms stay at or below 26°C.", why: "Comfort floor for students (suspended only in a grid outage)." },
  { id: "G6", rule: "High-impact actions need operator approval.", why: "A human decides when many people are affected." },
];
