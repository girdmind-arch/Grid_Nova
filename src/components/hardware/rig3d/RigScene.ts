import * as THREE from "three";
import { GridScene, type Tone } from "@/components/grid/grid3d/GridScene";
import * as M from "@/components/grid/grid3d/models";
import type { HardwareState } from "@/types/hardware";
import { formatNumber } from "@/utils/format";
import * as R from "./rigModels";

/**
 * The tabletop rig as a 3D mini campus, in the same look as the simulated campus (it reuses
 * GridScene's renderer, lights, platforms, flow lines, labels, picking and camera). The layout
 * follows the ESP32 firmware's wiring:
 *
 *   power bank ─NO─┐                       ┌─ Hostel   (hostel branch)     ┌─ Library (library branch)
 *                  ├─ relay ── INA219 ─────┼───────────────────────────────┤
 *   adapter ───NC──┘                       └─ Labs     (critical branch)   └─ Admin   (extra branch)
 *
 *   ESP32 control tower (Wi-Fi, armed), emergency-stop pedestal.
 *
 * Every number on it is the rig's own measurement: volts, milliamps and PWM duty, never campus kW.
 * Flow lines are scaled in milliamps against the firmware's 350 mA local trip.
 */

const TRIP_MA = 350;
const BRANCHES = ["critical", "hostel", "library", "extra"] as const;
export type Branch = (typeof BRANCHES)[number];

/** Which building stands for which LED branch. */
export const BRANCH_NODE: Record<Branch, { id: string; name: string }> = {
  critical: { id: "labs", name: "Labs" },
  hostel: { id: "hostel", name: "Hostels" },
  library: { id: "library", name: "Library" },
  extra: { id: "admin", name: "Admin Block" },
};

type NodeId = "battery" | "adapter" | "relay" | "meter" | "esp32" | "estop" | "hostel" | "library" | "labs" | "admin";
type Layout = Record<NodeId, THREE.Vector3>;

/** Wide screens: sources on the left, the four buildings on the right (like the campus view). */
const WIDE: Layout = {
  battery: new THREE.Vector3(-10, 0, -4.6),
  adapter: new THREE.Vector3(-10, 0, 4.6),
  relay: new THREE.Vector3(-5.6, 0, 0),
  meter: new THREE.Vector3(-2.2, 0, 0),
  esp32: new THREE.Vector3(-2.2, 0, -4.6),
  estop: new THREE.Vector3(-5.6, 0, 4.6),
  hostel: new THREE.Vector3(2.2, 0, -4.6),
  library: new THREE.Vector3(6.6, 0, -4.6),
  labs: new THREE.Vector3(2.2, 0, 4.6),
  admin: new THREE.Vector3(6.6, 0, 4.6),
};
/**
 * Phones: the scene is turned a quarter (x runs down the screen, +z to the left), so the
 * parts are stacked top to bottom with room for every label.
 */
const NARROW: Layout = {
  adapter: new THREE.Vector3(-13, 0, 3.6),
  battery: new THREE.Vector3(-13, 0, -3.6),
  relay: new THREE.Vector3(-8.2, 0, 0),
  meter: new THREE.Vector3(-4, 0, 0),
  hostel: new THREE.Vector3(1, 0, -4.2),
  labs: new THREE.Vector3(1, 0, 4.2),
  library: new THREE.Vector3(6.2, 0, -4.2),
  admin: new THREE.Vector3(6.2, 0, 4.2),
  esp32: new THREE.Vector3(11, 0, -3.6),
  estop: new THREE.Vector3(11, 0, 3.6),
};
const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

/** Hour of the day in India, for the light (the rig runs in real time). */
function istHour() {
  const d = new Date();
  return (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24;
}

export class RigScene extends GridScene {
  protected rig: HardwareState | null = null;
  protected rigMats: {
    nc: THREE.MeshStandardMaterial;
    no: THREE.MeshStandardMaterial;
    screen: THREE.MeshStandardMaterial;
    beacon: THREE.MeshStandardMaterial;
    estopHead: THREE.MeshStandardMaterial;
    estopCollar: THREE.MeshStandardMaterial;
  } | null = null;
  protected armTarget = 0.5;
  protected online = false;
  protected estopOn = false;

  constructor(host: HTMLElement) {
    super(host);
    this.buildRig();
    this.applyPalette();
    this.root.updateMatrixWorld(true);
  }

  /** The campus sources are not built here: the rig has its own parts (see buildRig). */
  protected override buildNodes() {}

  protected buildRig() {
    const std = (o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ roughness: 0.4, ...o });
    this.rigMats = {
      nc: std({ emissiveIntensity: 1 }),
      no: std({ emissiveIntensity: 1 }),
      screen: std({ roughness: 0.25, emissiveIntensity: 1 }),
      beacon: std({ emissiveIntensity: 1.4 }),
      estopHead: std({ roughness: 0.35, emissiveIntensity: 0 }),
      estopCollar: std({ roughness: 0.5 }),
    };
    const m = this.mats.models;
    const r = this.rigMats;
    const P = WIDE;
    this.addNode("battery", P.battery, [3.0, 2.2], M.batteryBank(m, this.mats.batteryFill));
    this.addNode("adapter", P.adapter, [3.4, 2.8], M.gridSubstation(m));
    this.addNode("relay", P.relay, [2.2, 2.0], R.relaySwitchyard(m, { nc: r.nc, no: r.no }));
    this.addNode("meter", P.meter, [2.0, 2.0], R.meterHouse(m, r.screen));
    this.addNode("esp32", P.esp32, [2.2, 2.2], R.controlTower(m, r.beacon));
    this.addNode("estop", P.estop, [1.8, 1.8], R.estopPedestal(m, r.estopHead, r.estopCollar));
    this.addNode("hostel", P.hostel, [2.4, 2.2], M.hostel(m));
    this.addNode("library", P.library, [2.4, 2.2], M.library(m));
    // front row: labels in front of the platforms, like the campus view
    this.addNode("labs", P.labs, [4.0, 2.2], R.twinLabs(m), 0, true);
    this.addNode("admin", P.admin, [2.4, 2.2], M.admin(m), 0, true);
    // The power bank's charge is unknown (a USB bank's voltage does not tell it): no fill level is drawn.
    for (const f of (this.nodes.get("battery")?.model.userData.fills ?? []) as THREE.Mesh[]) f.visible = false;
    // keep each whole platform in frame (some are bigger than a campus building's)
    const sizes: Record<string, [number, number]> = { adapter: [3.4, 2.8], battery: [3.0, 2.2], labs: [4.0, 2.2] };
    for (const [id, n] of this.nodes) {
      const [w, dd] = sizes[id] ?? [2.4, 2.2];
      n.fit = [w / 2 + 0.15, dd / 2 + 0.15];
    }
  }

  protected layout(): Layout {
    return this.narrow ? NARROW : WIDE;
  }

  /** Moves the parts to the wide or the phone layout. */
  protected place() {
    const L = this.layout();
    for (const [id, pos] of Object.entries(L)) {
      const n = this.nodes.get(id);
      if (n) n.group.position.set(pos.x, n.group.position.y, pos.z);
    }
  }

  override applyPalette() {
    super.applyPalette();
    const r = this.rigMats;
    if (!r) return; // called once from the base constructor, before the rig parts exist
    const p = this.pal;
    r.screen.color.copy(p.accent);
    r.screen.emissive.copy(p.accent);
    r.estopHead.color.copy(p.danger);
    r.estopHead.emissive.copy(p.danger);
    r.estopCollar.color.copy(p.warning);
  }

  protected override refresh() {
    this.place();
    if (this.rig) this.updateRig(this.rig);
  }

  /** Feeds the latest rig telemetry into the scene. */
  updateRig(hw: HardwareState) {
    this.rig = hw;
    if (!this.rigMats) return;
    this.shadowsDirty = true;
    this.setAtmosphere(istHour());
    const p = this.pal;
    const r = this.rigMats;
    const d = hw.device;

    const known = d.status !== "never_seen";
    const online = d.status === "online";
    this.online = online;
    const out = d.readings.output ?? null;
    const supplyLost = !!out && out.voltageV < (hw.limits?.supplyLostV ?? 1);
    const live = online && !supplyLost;
    const onBank = d.source === "powerbank";
    const onAdapter = d.source === "adapter";
    const adapterGone = d.adapter?.present === false;
    const estop = hw.estop.active;
    this.estopOn = estop;
    const totalMa = out ? Math.max(0, out.currentA * 1000) : 0;

    // ---- branches: what each LED branch is doing, from the reported PWM duty ----
    const names = d.branches?.length ? d.branches : hw.capabilities.loads.map((l) => l.name);
    const br = BRANCHES.map((name) => {
      const on = !!d.loads[name];
      const level = on ? (d.brightness?.[name] ?? 255) : 0;
      const full = d.model?.branchMa[name];
      const ma = on ? (full !== undefined ? full : 30) * (level / 255) : 0;
      return { name, fitted: names.includes(name) || name in d.loads, on: on && level > 0, level, ma, full, confident: !!d.model?.confident };
    });
    const branchMa = br.reduce((a, b) => a + b.ma, 0);
    // trunk flow: the measured current when there is one, else the branches' estimate
    const trunk = live ? Math.max(totalMa, branchMa, 4) : 0;

    // ---- labels, rings, heat pads ----
    const ma = (x: number) => (x < 1000 ? `${formatNumber(x)} mA` : `${(x / 1000).toFixed(2)} A`);
    this.setLabel(
      "adapter",
      "Wall adapter",
      !known ? "Not seen" : adapterGone ? "Unplugged" : onAdapter && live ? "Supplying" : d.adapter?.present ? "Plugged in" : "Unknown",
      d.adapter?.sensed && d.adapter.senseV !== null ? `sense ${d.adapter.senseV.toFixed(2)} V` : "no sense divider",
      adapterGone && known ? "fault" : "grid",
    );
    this.ring("adapter", adapterGone && known ? "fault" : onAdapter && live ? "zone" : "idle");
    this.setHeat("adapter", adapterGone && known ? p.danger : p.accent, adapterGone && known ? 0.35 : onAdapter && live ? 0.25 : 0.06);

    this.setLabel("battery", "Power bank", onBank && live ? "Supplying" : "Standby", "charge unknown", "battery");
    this.ring("battery", onBank && live ? "battery" : "idle");
    this.setHeat("battery", p.success, onBank && live ? 0.3 : 0.06);
    this.batteryDir = onBank && live ? -1 : 0;

    this.armTarget = onBank ? -0.5 : 0.5;
    this.setLabel("relay", "Relay", onBank ? "Power bank" : onAdapter ? "Adapter" : "Switching…", onBank ? "ON · NO contact" : onAdapter ? "OFF · NC contact" : "SPDT", "zone");
    this.ring("relay", live ? "zone" : "idle");
    this.setHeat("relay", onBank ? p.success : p.accent, live ? 0.2 : 0.05);
    const lit = (mat: THREE.MeshStandardMaterial, on: boolean, c: THREE.Color) => {
      mat.color.copy(on ? c : p.idle);
      mat.emissive.copy(on ? c : new THREE.Color(0x000000));
    };
    lit(r.nc, onAdapter, p.accent);
    lit(r.no, onBank, p.success);

    this.setLabel(
      "meter",
      "INA219",
      out ? `${out.voltageV.toFixed(2)} V · ${ma(totalMa)}` : "No reading",
      out ? `${out.powerW < 1 ? `${formatNumber(out.powerW * 1000)} mW` : `${out.powerW.toFixed(2)} W`}${out.fresh ? "" : " · stale"}` : undefined,
      supplyLost ? "fault" : "zone",
    );
    this.ring("meter", supplyLost ? "fault" : live ? "zone" : "idle");
    this.setHeat("meter", supplyLost ? p.danger : p.accent, supplyLost ? 0.35 : 0.08 + 0.3 * Math.min(1, totalMa / TRIP_MA));
    r.screen.emissiveIntensity = out ? 1 : 0.15;

    this.setLabel(
      "esp32",
      "ESP32",
      online ? `Online · ${d.ageS !== null ? `${Math.round(d.ageS)} s` : "now"}` : known ? "Offline" : "Not seen yet",
      `${hw.armed ? "Armed" : "Not armed"}${d.firmware ? ` · fw ${d.firmware}` : ""}`,
      online ? "zone" : "idle",
    );
    this.ring("esp32", online ? "reroute" : "idle");
    this.setHeat("esp32", p.ai, online ? 0.18 : 0.04);
    r.beacon.color.copy(online ? p.success : p.idle);
    r.beacon.emissive.copy(online ? p.success : new THREE.Color(0x000000));
    this.setWindows("esp32", online ? 1 : 0.1);

    this.setLabel("estop", "E-stop", estop ? "Latched" : "Ready", estop ? "all loads off" : undefined, estop ? "fault" : "idle");
    this.ring("estop", estop ? "fault" : "idle");
    this.setHeat("estop", p.danger, estop ? 0.4 : 0.03);
    r.estopHead.emissiveIntensity = estop ? 0.9 : 0.05;

    for (const b of br) {
      const node = BRANCH_NODE[b.name];
      const on = live && b.on && !estop;
      const pct = Math.round((b.level * 100) / 255);
      const critical = b.name === "critical";
      const sub = !known
        ? "no data"
        : !b.fitted
        ? "not fitted"
        : estop
          ? "e-stop"
          : !b.on
            ? critical ? "off" : "shed"
            : b.confident && b.full !== undefined
              ? `≈ ${formatNumber(b.ma)} mA`
              : critical ? "core · never shed" : "on";
      const shed = known && b.fitted && !b.on && !critical && !estop;
      this.setLabel(node.id, node.name, !known ? "–" : b.on ? `PWM ${pct}%` : "Off", sub, estop && b.fitted ? "fault" : shed ? "warning" : "zone", critical);
      this.ring(node.id, estop && b.fitted ? "fault" : on ? "zone" : "idle", shed);
      // the LED brightness is the building's window light
      this.setWindows(node.id, on ? 0.1 + 0.9 * (b.level / 255) : 0.04);
      this.setHeat(node.id, estop ? p.danger : p.solar, estop ? 0.3 : on ? 0.06 + 0.3 * (b.level / 255) : 0.02);
    }

    // ---- power path: flow lines (values in mA) ----
    const lines: [THREE.Vector3[], number, number, Tone][] = [];
    const P = this.layout();
    const inX = P.relay.x - 1.1;
    const jx = P.relay.x - 1.8;
    lines.push([[P.adapter, v(jx, P.adapter.z), v(jx, 0.5), v(inX, 0.5)], onAdapter && live ? trunk : 0, TRIP_MA, adapterGone && known ? "fault" : "grid"]);
    lines.push([[P.battery, v(jx, P.battery.z), v(jx, -0.5), v(inX, -0.5)], onBank && live ? trunk : 0, TRIP_MA, "battery"]);
    const tone: Tone = onBank ? "battery" : "zone";
    lines.push([[v(P.relay.x + 1.1, 0), v(P.meter.x - 1.0, 0)], trunk, TRIP_MA, tone]);
    lines.push([[v(P.meter.x + 1.0, 0), v(Math.max(P.admin.x, P.library.x), 0)], supplyLost ? 0 : trunk, TRIP_MA, supplyLost ? "fault" : tone]);
    for (const b of br) {
      const pos = P[BRANCH_NODE[b.name].id as NodeId];
      const sign = pos.z < 0 ? -1 : 1;
      const flow = live && b.on && !estop ? Math.max(b.ma, 4) : 0;
      lines.push([[v(pos.x, 0), v(pos.x, pos.z - sign * 1.2)], flow, TRIP_MA / 2, tone]);
    }
    const q = (x: number, max: number) => (x <= 1 ? 0 : Math.max(2, (Math.round((Math.min(x, max) / max) * 20) / 20) * max));
    const sig = lines.map(([pts, x, max, t]) => `${pts.map((u) => `${u.x},${u.z}`).join(";")}|${q(x, max)}|${t}`).join("/");
    if (sig !== this.lineSig) {
      this.lineSig = sig;
      this.clearLines();
      for (const [pts, x, max, t] of lines) this.addLine(pts, q(x, max), max, t);
    }
    this.requestFrame();
  }

  /** Rig windows are LED light: an off branch goes properly dark (the campus keeps a dim glow). */
  protected override setWindows(id: string, level: number) {
    const node = this.nodes.get(id);
    if (!node || node.windowLevel === level) return;
    node.windowLevel = level;
    const key = 1000 + Math.round(level * 100);
    let mat = this.windowMats.get(key);
    if (!mat) {
      mat = this.mats.models.window.clone();
      mat.emissiveIntensity = level * this.mats.models.window.emissiveIntensity;
      mat.color.copy(level < 0.1 ? this.pal.dark : this.mats.models.window.color.clone().multiplyScalar(0.35 + 0.65 * level));
      this.windowMats.set(key, mat);
    }
    node.model.traverse((o) => {
      if (o.userData.isWindows) (o as THREE.Mesh).material = mat;
    });
  }

  protected override animate(dt: number) {
    super.animate(dt);
    const moving = !this.reduceMotion && dt > 0;
    const arm = this.nodes.get("relay")?.model.userData.arm as THREE.Object3D | undefined;
    if (arm && Math.abs(arm.rotation.y - this.armTarget) > 1e-3) {
      arm.rotation.y = moving ? arm.rotation.y + (this.armTarget - arm.rotation.y) * Math.min(1, dt * 6) : this.armTarget;
      this.shadowsDirty = true;
    }
    const r = this.rigMats;
    if (!r) return;
    // ESP32 beacon blinks once every two seconds while online (its telemetry cadence)
    r.beacon.emissiveIntensity = this.online ? (moving ? 0.5 + 1.2 * Math.max(0, Math.sin(this.t * Math.PI)) : 1.4) : 0;
    // a latched e-stop pulses
    if (this.estopOn && moving) r.estopHead.emissiveIntensity = 0.6 + 0.4 * Math.sin(this.t * 6);
  }
}
