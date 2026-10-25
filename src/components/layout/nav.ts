import { Bot, ChartColumn, Gauge, History, Settings, Wrench, Zap } from "lucide-react";

// Single source of truth for app navigation (sidebar, bottom nav, search).

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  /** Words people might type into search to find this page. */
  keywords: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/app", label: "Control Room", icon: Gauge, keywords: "home dashboard grid live demand solar battery" },
  { to: "/app/agents", label: "Agents", icon: Bot, keywords: "orchestrator forecaster planner critic guardrail trace thinking" },
  { to: "/app/scenarios", label: "Scenarios", icon: Zap, keywords: "fault cloud heatwave line failure outage break" },
  { to: "/app/maintenance", label: "Maintenance", icon: Wrench, keywords: "maintenance repair ticket faults ac hvac grid solar battery technician" },
  { to: "/app/memory", label: "Memory", icon: History, keywords: "incidents lessons learned history" },
  { to: "/app/results", label: "Results", icon: ChartColumn, keywords: "baseline savings cost peak recovery judges" },
  { to: "/app/settings", label: "Settings", icon: Settings, keywords: "theme dark light mode goal guardrails" },
];

/** First three items go in the mobile bottom bar; the rest live under "More". */
export const PRIMARY_MOBILE = NAV_ITEMS.slice(0, 3);
export const MORE_MOBILE = NAV_ITEMS.slice(3);
