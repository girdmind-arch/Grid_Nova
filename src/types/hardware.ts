// The tabletop ESP32 rig. These are volts and amps at USB level: they are NEVER campus kW/kWh and
// are never mixed into GridState. See the "Hardware demo" section of the README.

export type DataSource = "simulation" | "hardware-demo";
export type DeviceStatus = "online" | "offline" | "never_seen";
export type SourceName = "adapter" | "powerbank";
export type CommandStatus = "awaiting_approval" | "queued" | "delivered" | "applied" | "rejected" | "failed" | "expired" | "cancelled";

export interface RigReading {
  voltageV: number;
  currentA: number;
  /** Computed from V x I, not a separate measurement. */
  powerW: number;
  kind: "measured";
  fresh: boolean;
}

export interface RigCommand {
  id: string;
  type: "select_source" | "set_load" | "estop" | "clear_estop";
  params: Record<string, string | boolean>;
  origin: "operator" | "scenario" | "system";
  status: CommandStatus;
  reason: string | null;
  /** The device said it did it AND the next readings showed it. */
  physicallyPerformed: boolean;
  verified: boolean | null;
  createdAt: string;
}

export type HardwareHonesty = "supported" | "approximation" | "simulated_only" | "software_only";

export interface HardwareState {
  dataSource: DataSource;
  /** Always "simulation": the campus numbers elsewhere in the app. */
  campusDataSource: "simulation";
  mode: DataSource;
  configured: boolean;
  armed: boolean;
  armedUntil: string | null;
  armedBy: string | null;
  estop: { active: boolean; reason: string | null; resetPending: boolean };
  device: {
    id: string | null;
    status: DeviceStatus;
    ageS: number | null;
    firmware: string | null;
    source: SourceName | "none" | null;
    loads: Record<string, boolean>;
    readings: { adapter: RigReading | null; battery: RigReading | null; output?: RigReading | null };
    /** Adapter sense (voltage divider): present = the wall adapter is supplying (debounced). */
    adapter?: { present: boolean | null; senseV: number | null; sensed: boolean };
    /** "output": one INA219 after the relay (recommended build); "per-source": one per source. */
    sensorLayout?: "output" | "per-source" | null;
    branches?: string[];
    /** Branch currents learned from this rig's own readings. */
    model?: RigModel;
    /** What the learned model expects the rig to draw in its current state (A). */
    predictedCurrentA?: number | null;
    health: Partial<Record<"ina219Adapter" | "ina219Battery" | "ina219Output" | "adapterSense" | "muxInterlock", string | null>> | null;
    warnings: string[];
    stateOfCharge: { status: "unknown"; socPct: null; reason: string };
  };
  commands: RigCommand[];
  capabilities: {
    scenarios: Record<string, { hardware: HardwareHonesty; approval: boolean; summary: string }>;
    loads: { name: string; essential: boolean }[];
  };
  events?: { at: string; level: "info" | "warning" | "error"; text: string }[];
  limits?: { freshS: number; offlineAfterS: number; armMaxMin: number; commandTtlS: number; keepAliveA?: number; tripA?: number; supplyLostV?: number };
}

export interface RigModel {
  baseMa: number;
  branchMa: Record<string, number>;
  samples: number;
  /** True once the readings have seen enough on/off combinations to tell the branches apart. */
  confident: boolean;
}

export type DispatchOutcome =
  | "simulated_only"
  | "software_only"
  | "unsupported_on_hardware"
  | "awaiting_approval"
  | "hardware_pending";

/** What happened on the rig when a scenario started or was approved. The simulation runs either way. */
export interface HardwareDispatch {
  dataSource: DataSource;
  outcome: DispatchOutcome;
  physicallyPerformed: boolean;
  reason: string;
  commandIds: string[];
}
