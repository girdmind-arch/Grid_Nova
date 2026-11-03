// hi
// MOCK: past incidents and the Critic's lessons learned.

import type { IncidentMemory } from "@/types/agents";

export const MEMORY: IncidentMemory = {
  incidents: [
    {
      id: "INC-41",
      occurredAt: "2026-05-11T14:05:00+05:30",
      type: "cloud_cover",
      title: "Sudden cloud cover",
      cause: "Solar output fell from 640 kW to 210 kW in 9 minutes.",
      action: "Battery covered the gap; library HVAC eased by 1°C.",
      outcome: "No zone lost power. Extra cost ₹620.",
      recoveryMin: 3,
    },
    {
      id: "INC-40",
      occurredAt: "2026-05-08T19:32:00+05:30",
      type: "line_failure",
      title: "Feeder fault near GH1",
      cause: "Cable joint failure on feeder F3.",
      action: "Isolated GH1 and rerouted via feeder F2.",
      outcome: "Power restored to 96% of the hostel in 6 minutes.",
      recoveryMin: 6,
    },
    {
      id: "INC-38",
      occurredAt: "2026-05-05T18:00:00+05:30",
      type: "heatwave",
      title: "Heatwave evening peak",
      cause: "42°C day pushed demand 11% above forecast.",
      action: "Pre-cooled hostels from 17:30 and discharged battery in the peak.",
      outcome: "Peak import cut by 290 kW. Comfort stayed above 95%.",
      recoveryMin: 0,
    },
    {
      id: "INC-35",
      occurredAt: "2026-04-29T21:10:00+05:30",
      type: "grid_outage",
      title: "Main grid outage",
      cause: "Upstream substation trip (UPPCL).",
      action: "Islanded the campus on battery; hostels reduced to 60%.",
      outcome: "Labs and library kept full power for 48 minutes.",
      recoveryMin: 2,
    },
  ],
  lessons: [
    { id: "L-12", incidentId: "INC-41", note: "Keep 15% battery headroom on partly cloudy afternoons.", appliedCount: 3 },
    { id: "L-11", incidentId: "INC-40", note: "Pre-check feeder F2 capacity before evening rerouting.", appliedCount: 1 },
    { id: "L-09", incidentId: "INC-38", note: "Start pre-cooling 30 minutes before peak when above 40°C.", appliedCount: 4 },
  ],
};
