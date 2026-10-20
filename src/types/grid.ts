// Shared data shapes. These describe what the FastAPI backend will send.
// The mock services return the exact same shapes, so swapping is painless.

export type ControlMode = "ai" | "fallback" | "manual";
export type Trend = "up" | "down" | "flat";
export type ISODate = string;

export type ZoneKind = "hostel" | "lab" | "library" | "admin" | "academic" | "residence";
export type ZoneStatus = "normal" | "reduced" | "faulted" | "isolated";
export type ZonePriority = "critical" | "high" | "normal";

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  demandKw: number;
  status: ZoneStatus;
  priority: ZonePriority;
  /** Short plain-language note, e.g. "On backup feeder F2". */
  note?: string;
}

export type TariffSlab = "off-peak" | "normal" | "peak";

export interface Tariff {
  slab: TariffSlab;
  ratePerKwh: number; // INR
  label: string; // e.g. "Peak · 18:00–22:00"
}

/** Grid nodes power flows between. Zones use their zone id. */
export type SourceNodeId = "solar" | "battery" | "grid" | "bus";

export interface PowerFlow {
  from: SourceNodeId | string;
  to: SourceNodeId | string;
  kw: number;
}

export interface BatteryState {
  socPct: number; // state of charge, 0–100
  powerKw: number; // + charging, - discharging
  capacityKwh: number;
}

/** Where the live numbers come from (sent by the backend). */
export interface Environment {
  clock: "live" | "demo";
  /** Simulated minutes per real minute (1 in live mode). */
  speed: number;
  weatherSource: "open-meteo" | "profile";
  location: string;
  /** Indian state or UT of the campus, and its power company. */
  state: string;
  discom: string;
  temperatureC: number;
  cloudPct: number;
  solarPotentialKw: number;
  weatherUpdatedAt: ISODate | null;
}

/** A campus location in India and the state's (illustrative) time-of-day tariff. */
export interface CampusLocation {
  name: string;
  state: string;
  lat: number;
  lon: number;
  discom: string;
  tariff: { offPeak: number; normal: number; peak: number };
}

export interface GridState {
  /** Always "simulation": campus numbers never come from the tabletop rig. */
  dataSource?: "simulation";
  timestamp: ISODate;
  mode: ControlMode;
  demandKw: number;
  solarKw: number;
  gridImportKw: number;
  battery: BatteryState;
  costTodayInr: number;
  /** What today would have cost with no AI (rule-free baseline). */
  baselineCostTodayInr: number;
  tariff: Tariff;
  trends: { demand: Trend; solar: Trend; battery: Trend; grid: Trend; cost: Trend };
  zones: Zone[];
  flows: PowerFlow[];
  activeFault: ActiveFault | null;
  /** Present when the live backend is connected. */
  environment?: Environment;
}

// ---------- Forecast ----------
export interface ForecastPoint {
  time: ISODate;
  demandKw: number;
  solarKw: number;
  tariffInr: number;
  temperatureC?: number;
}

export interface ForecastEvent {
  id: string;
  time: ISODate;
  title: string;
  detail: string;
  kind: "peak" | "solar" | "tariff" | "weather";
}

export interface Forecast {
  generatedAt: ISODate;
  horizonHours: number;
  points: ForecastPoint[];
  events: ForecastEvent[];
  /** The learned model behind the demand line (live backend only). */
  model?: { name: string; maeKw: number; baselineMaeKw: number; onlineUpdates: number } | null;
}

// ---------- Faults / scenarios ----------
export type FaultType = "cloud_cover" | "heatwave" | "line_failure" | "grid_outage";

export interface FaultRequest {
  type: FaultType;
  severity: number; // 1 (mild) – 5 (severe)
  durationMin: number;
  targetZoneId?: string; // for line_failure
}

export interface ActiveFault extends FaultRequest {
  /** "rig": started by a physical event on the tabletop rig (e.g. its wall adapter was unplugged). */
  origin?: "website" | "rig";
  note?: string;
  incidentId: string;
  startedAt: ISODate;
  /** True once the agents' response has been applied to the grid. */
  mitigated: boolean;
}

export interface FaultResult {
  incidentId: string;
  startedAt: ISODate;
  message: string;
  /** Whether the tabletop rig was involved (backend only). Absent on demo data. */
  hardware?: import("./hardware").HardwareDispatch;
}
