import { Cloud, Flame, Unplug, Zap } from "lucide-react";
import type { FaultType } from "@/types/grid";
import type { IconTileTone } from "@/components/ui/IconTile";

// How each scenario is named and shown across the app.

export const SCENARIOS: Record<
  FaultType,
  {
    title: string;
    blurb: string;
    icon: typeof Cloud;
    tone: IconTileTone;
    activeLabel: string;
    /** A plain-language preview; the digital twin can choose a different safe plan. */
    response: string;
    /** What each severity level (1–5) means for this scenario. */
    severity: [string, string, string, string, string];
  }
> = {
  cloud_cover: {
    title: "Cloud Cover",
    blurb: "Solar output drops suddenly.",
    icon: Cloud,
    tone: "solar",
    activeLabel: "Cloud cover is cutting solar output",
    response: "Compare battery support, import caps and load shifting in the twin, then apply the best safe plan.",
    severity: ["Solar −15%", "Solar −30%", "Solar −45%", "Solar −60%", "Solar −75%"],
  },
  heatwave: {
    title: "Heatwave",
    blurb: "Cooling demand spikes across hostels.",
    icon: Flame,
    tone: "warning",
    activeLabel: "Heatwave is pushing demand up",
    response: "Compare battery support and cooling adjustments, then apply the best safe plan.",
    severity: ["Demand +4%", "Demand +8%", "Demand +12%", "Demand +16%", "Demand +20%"],
  },
  line_failure: {
    title: "Line Failure",
    blurb: "The feeder cable to GH1 trips.",
    icon: Zap,
    tone: "danger",
    activeLabel: "Line failure near GH1",
    response: "Isolate the faulty feeder and test a safe reroute through F2; if none is safe, keep the zone isolated for repair.",
    severity: ["Brief flicker", "Short trip", "Feeder trip", "Cable damage", "Cable and joint damage"],
  },
  grid_outage: {
    title: "Grid Outage",
    blurb: "The main grid supply is lost.",
    icon: Unplug,
    tone: "accent",
    activeLabel: "Main grid supply is lost",
    response: "Test solar, battery and hostel-load options; get operator approval before reducing hostel power.",
    severity: ["Voltage dip", "Short outage", "Full outage", "Long outage", "Area-wide blackout"],
  },
};

export const SCENARIO_ORDER: FaultType[] = ["cloud_cover", "heatwave", "line_failure", "grid_outage"];
