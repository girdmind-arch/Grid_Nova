import { useId } from "react";
import type { HardwareState } from "@/types/hardware";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/cn";
import { amps, watts } from "./RigReadings";

// The Control Room's live grid while the data source is "Rig".
//
// It draws the tabletop rig the way the ESP32 firmware wires it, not the campus:
//
//   wall adapter ──NC──┐
//                      ├─ SPDT relay ──COM── INA219 ── load rail ──┬─ MOSFET ─ critical LEDs
//   power bank ───NO───┘                                          ├─ MOSFET ─ hostel LEDs
//                                                                 ├─ MOSFET ─ library LEDs
//   ESP32 (Wi-Fi, PWM, adapter sense, e-stop button)              └─ MOSFET ─ extra LEDs
//
// Every number comes from the rig's own telemetry (volts, milliamps, PWM duty). Nothing here is campus kW.
// The control wires (relay coil, MOSFET gates, I2C) are left out so the power path stays readable.

const BRANCHES = ["critical", "hostel", "library", "extra"] as const;
const TRIP_A = 0.35;

type Pt = { x: number; y: number };
interface Layout {
  W: number;
  H: number;
  vertical: boolean;
  adapter: Box;
  bank: Box;
  relay: Box;
  nc: Pt;
  no: Pt;
  com: Pt;
  ncIn: Pt;
  noIn: Pt;
  comIn: Pt;
  ina: Box;
  inaOut: Pt;
  busX: number;
  busTop: number;
  feed: Pt;
  rows: number[];
  mos: { x: number; w: number; h: number };
  led: { x: number; w: number; h: number };
  esp: Box;
  estop: Box;
}
type Box = { x: number; y: number; w: number; h: number };

function layoutFor(narrow: boolean): Layout {
  if (!narrow) {
    const rows = [92, 206, 320, 434];
    const relay = { x: 268, y: 185, w: 128, h: 150 };
    return {
      W: 960, H: 560, vertical: false,
      adapter: { x: 24, y: 40, w: 188, h: 104 },
      bank: { x: 24, y: 376, w: 188, h: 104 },
      relay,
      nc: { x: relay.x, y: relay.y + 50 }, no: { x: relay.x, y: relay.y + relay.h - 50 }, com: { x: relay.x + relay.w, y: relay.y + relay.h / 2 },
      ncIn: { x: relay.x + 32, y: relay.y + 50 }, noIn: { x: relay.x + 32, y: relay.y + relay.h - 50 }, comIn: { x: relay.x + relay.w - 32, y: relay.y + relay.h / 2 },
      ina: { x: 454, y: 228, w: 120, h: 64 },
      inaOut: { x: 574, y: 260 },
      busX: 640, busTop: rows[0], feed: { x: 640, y: 260 },
      rows,
      mos: { x: 690, w: 92, h: 56 },
      led: { x: 810, w: 138, h: 70 },
      esp: { x: 268, y: 470, w: 306, h: 70 },
      estop: { x: 24, y: 496, w: 188, h: 48 },
    };
  }
  const rows = [466, 566, 666, 766];
  const relay = { x: 134, y: 160, w: 152, h: 130 };
  return {
    W: 420, H: 920, vertical: true,
    adapter: { x: 10, y: 10, w: 190, h: 104 },
    bank: { x: 220, y: 10, w: 190, h: 104 },
    relay,
    nc: { x: relay.x + 36, y: relay.y }, no: { x: relay.x + relay.w - 36, y: relay.y }, com: { x: relay.x + relay.w / 2, y: relay.y + relay.h },
    ncIn: { x: relay.x + 36, y: relay.y + 52 }, noIn: { x: relay.x + relay.w - 36, y: relay.y + 52 }, comIn: { x: relay.x + relay.w / 2, y: relay.y + relay.h - 38 },
    ina: { x: 150, y: 322, w: 120, h: 60 },
    inaOut: { x: 210, y: 382 },
    busX: 36, busTop: 426, feed: { x: 36, y: 426 },
    rows,
    mos: { x: 74, w: 92, h: 54 },
    led: { x: 212, w: 198, h: 64 },
    esp: { x: 10, y: 846, w: 250, h: 66 },
    estop: { x: 272, y: 850, w: 138, h: 58 },
  };
}

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const widthFor = (frac: number) => 2.5 + 5 * Math.sqrt(clamp(frac));

type Tone = "adapter" | "bank" | "fault";
const toneVar: Record<Tone, string> = { adapter: "var(--accent)", bank: "var(--success)", fault: "var(--danger)" };

/** One wire. Active wires glow and carry moving dashes (direction = the path's direction). */
function Wire({ d, on, tone, frac = 0.3, broken }: { d: string; on: boolean; tone: Tone; frac?: number; broken?: boolean }) {
  if (broken) return <path d={d} fill="none" stroke="var(--danger)" strokeWidth={2.5} strokeDasharray="3 7" strokeLinecap="round" opacity={0.7} />;
  if (!on) return <path d={d} fill="none" stroke="var(--border-strong)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />;
  const w = widthFor(frac);
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={toneVar[tone]} strokeOpacity={0.22} strokeWidth={w + 3} />
      <path d={d} className="power-flow" stroke={toneVar[tone]} strokeWidth={Math.max(2, w * 0.55)} strokeDasharray="6 10" />
    </g>
  );
}

const box = (b: Box, stroke = "var(--border-strong)", fill = "var(--surface-solid)") => (
  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} fill={fill} stroke={stroke} strokeWidth={1.5} />
);

function T({ x, y, children, size = 13, weight = 500, fill = "var(--text)", anchor = "start", mono }: {
  x: number; y: number; children: React.ReactNode; size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; mono?: boolean;
}) {
  return (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} style={{ fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)", fontVariantNumeric: "tabular-nums" }}>
      {children}
    </text>
  );
}

/** Elbow wire from a to b: horizontal-first on the wide layout, vertical-first on the narrow one. */
function elbow(a: Pt, b: Pt, vertical: boolean) {
  if (vertical) {
    const my = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} V ${my} H ${b.x} V ${b.y}`;
  }
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} H ${mx} V ${b.y} H ${b.x}`;
}

export function RigGrid({ state, className }: { state: HardwareState; className?: string }) {
  const narrow = useMediaQuery("(max-width: 639px)");
  const L = layoutFor(narrow);
  const uid = useId().replace(/:/g, "");
  const d = state.device;

  const online = d.status === "online";
  const known = d.status !== "never_seen";
  const out = d.readings.output ?? null;
  const supplyLostV = state.limits?.supplyLostV ?? 1;
  const supplyLost = !!out && out.voltageV < supplyLostV;
  const estop = state.estop.active;
  const onBank = d.source === "powerbank";
  const onAdapter = d.source === "adapter";
  const adapterGone = d.adapter?.present === false;
  const live = online && !supplyLost;

  const names = d.branches?.length ? d.branches : state.capabilities.loads.map((l) => l.name);
  const essential = new Set(state.capabilities.loads.filter((l) => l.essential).map((l) => l.name));
  essential.add("critical");

  const levels = BRANCHES.map((n) => {
    const fitted = names.includes(n) || n in d.loads;
    const on = !!d.loads[n];
    const level = d.brightness?.[n] ?? (on ? 255 : 0);
    return { name: n, fitted, on: on && level > 0, level: on ? level : 0 };
  });
  const mA = (n: string) => d.model?.branchMa[n];
  const weights = levels.map((b) => (b.on ? (mA(b.name) ?? 20) * (b.level / 255) : 0));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const trunkFrac = out ? clamp(Math.max(out.currentA, 0) / TRIP_A) : totalW ? 0.3 : 0.1;
  const srcTone: Tone = onBank ? "bank" : "adapter";

  // The relay armature rests on the NC contact (adapter) and throws to NO (power bank).
  const armTo = onBank ? L.noIn : L.ncIn;
  const adapterOut: Pt = L.vertical ? { x: L.adapter.x + L.adapter.w / 2, y: L.adapter.y + L.adapter.h } : { x: L.adapter.x + L.adapter.w, y: L.adapter.y + L.adapter.h / 2 };
  const bankOut: Pt = L.vertical ? { x: L.bank.x + L.bank.w / 2, y: L.bank.y + L.bank.h } : { x: L.bank.x + L.bank.w, y: L.bank.y + L.bank.h / 2 };
  const dAdapter = elbow(adapterOut, L.nc, L.vertical);
  const dBank = elbow(bankOut, L.no, L.vertical);
  const dRelayAdapter = `M ${L.nc.x} ${L.nc.y} L ${L.ncIn.x} ${L.ncIn.y}`;
  const dRelayBank = `M ${L.no.x} ${L.no.y} L ${L.noIn.x} ${L.noIn.y}`;
  const dCom = `M ${L.comIn.x} ${L.comIn.y} L ${L.com.x} ${L.com.y}`;
  const dToIna = L.vertical ? `M ${L.com.x} ${L.com.y} V ${L.ina.y}` : `M ${L.com.x} ${L.com.y} H ${L.ina.x}`;
  const dInaOut = L.vertical ? `M ${L.inaOut.x} ${L.inaOut.y} V ${L.feed.y} H ${L.feed.x}` : `M ${L.inaOut.x} ${L.inaOut.y} H ${L.feed.x}`;
  const dBus = `M ${L.busX} ${L.busTop} V ${L.rows[3]}`;

  const adapterOn = live && onAdapter && !adapterGone;
  const bankOn = live && onBank;
  const trunkOn = live && (onAdapter || onBank);

  const sense = d.adapter;
  const relayText = onBank ? "ON · power bank" : onAdapter ? "OFF · adapter" : "switching…";
  const status = !known
    ? "Waiting for the ESP32's first reading"
    : !online
      ? "Rig offline: showing its last reported state"
      : supplyLost
        ? "No supply on the load rail"
        : null;

  const summary = [
    `Supply from ${onBank ? "the power bank" : onAdapter ? "the wall adapter" : "neither source"}.`,
    out ? `Load rail ${out.voltageV.toFixed(2)} volts, ${amps(out.currentA)}.` : "No load-rail reading.",
    ...levels.filter((b) => b.fitted).map((b) => `${b.name} ${b.on ? `on at ${Math.round((b.level * 100) / 255)} percent` : "off"}.`),
    estop ? "Emergency stop is latched." : "",
  ].join(" ");

  return (
    <div className={cn("min-w-0", className)}>
      {status && (
        <p role="status" className={cn("mb-3 inline-flex items-center rounded-full border px-3 py-1 text-[13px] font-semibold", supplyLost ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface-sunken text-fg-muted")}>
          {status}
        </p>
      )}
      <svg role="img" aria-label="Tabletop rig power path" viewBox={`0 0 ${L.W} ${L.H}`} className="block h-auto w-full select-none" preserveAspectRatio="xMidYMid meet">
        <desc>{summary}</desc>
        <defs>
          <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* ---------- wires (under the boxes) ---------- */}
        <Wire d={dAdapter} on={adapterOn} tone="adapter" frac={trunkFrac} broken={adapterGone && known} />
        <Wire d={dBank} on={bankOn && onBank} tone="bank" frac={trunkFrac} />
        <Wire d={dToIna} on={trunkOn} tone={srcTone} frac={trunkFrac} />
        <Wire d={dInaOut} on={trunkOn} tone={supplyLost ? "fault" : srcTone} frac={trunkFrac} />
        <Wire d={dBus} on={trunkOn && totalW > 0} tone={srcTone} frac={trunkFrac} />

        {/* ---------- sources ---------- */}
        <g>
          {box(L.adapter, adapterGone && known ? "var(--danger)" : onAdapter && live ? "var(--accent)" : "var(--border-strong)")}
          <T x={L.adapter.x + 14} y={L.adapter.y + 26} weight={700}>Wall adapter</T>
          <T x={L.adapter.x + 14} y={L.adapter.y + 48} size={12} fill={adapterGone && known ? "var(--danger)" : "var(--text-muted)"}>
            {sense?.present === true ? "Plugged in, supplying" : sense?.present === false ? "Not supplying" : "Sense unknown"}
          </T>
          <T x={L.adapter.x + 14} y={L.adapter.y + 68} size={12} fill="var(--text-subtle)" mono>
            {sense?.sensed && sense.senseV !== null ? `sense ${sense.senseV.toFixed(2)} V` : "no sense divider"}
          </T>
          <T x={L.adapter.x + 14} y={L.adapter.y + 88} size={11} fill="var(--text-subtle)">ADC divider · GPIO 34</T>
        </g>
        <g>
          {box(L.bank, onBank && live ? "var(--success)" : "var(--border-strong)")}
          <T x={L.bank.x + 14} y={L.bank.y + 26} weight={700}>Power bank</T>
          <T x={L.bank.x + 14} y={L.bank.y + 48} size={12} fill="var(--text-muted)">{onBank ? "Supplying the rig" : "Standby"}</T>
          <T x={L.bank.x + 14} y={L.bank.y + 68} size={12} fill="var(--text-subtle)">Charge: unknown</T>
          <T x={L.bank.x + 14} y={L.bank.y + 88} size={11} fill="var(--text-subtle)">USB voltage can't tell</T>
        </g>

        {/* ---------- SPDT relay ---------- */}
        <g>
          {box(L.relay, onBank && live ? "var(--success)" : onAdapter && live ? "var(--accent)" : "var(--border-strong)")}
          <T x={L.relay.x + L.relay.w / 2} y={L.relay.y + 22} size={12} weight={700} anchor="middle">SPDT relay</T>
          <Wire d={dRelayAdapter} on={adapterOn && onAdapter} tone="adapter" frac={trunkFrac} />
          <Wire d={dRelayBank} on={bankOn && onBank} tone="bank" frac={trunkFrac} />
          {(() => {
            const active = onBank ? "bank" : "adapter";
            return (
              <>
                <circle cx={L.ncIn.x} cy={L.ncIn.y} r={5} fill={active === "adapter" ? "var(--accent)" : "var(--surface-solid)"} stroke="var(--border-strong)" strokeWidth={1.5} />
                <circle cx={L.noIn.x} cy={L.noIn.y} r={5} fill={active === "bank" ? "var(--success)" : "var(--surface-solid)"} stroke="var(--border-strong)" strokeWidth={1.5} />
              </>
            );
          })()}
          <text x={L.ncIn.x + 11} y={L.ncIn.y - 7} fontSize={10} fill="var(--text-subtle)" style={{ fontFamily: "var(--font-mono)" }}>NC</text>
          <text x={L.noIn.x + 11} y={L.noIn.y + (L.vertical ? -7 : 16)} fontSize={10} fill="var(--text-subtle)" style={{ fontFamily: "var(--font-mono)" }}>NO</text>
          <text x={L.comIn.x + 10} y={L.comIn.y + (L.vertical ? 16 : -9)} fontSize={10} fill="var(--text-subtle)" style={{ fontFamily: "var(--font-mono)" }}>COM</text>
          <Wire d={dCom} on={trunkOn} tone={srcTone} frac={trunkFrac} />
          <line
            x1={L.comIn.x} y1={L.comIn.y} x2={armTo.x} y2={armTo.y}
            stroke={onBank ? "var(--success)" : onAdapter ? "var(--accent)" : "var(--text-subtle)"} strokeWidth={4} strokeLinecap="round"
            style={{ transition: "all 400ms ease" }}
          />
          <circle cx={L.comIn.x} cy={L.comIn.y} r={5} fill="var(--text)" />
          <T x={L.relay.x + L.relay.w / 2} y={L.relay.y + L.relay.h - 8} size={11} anchor="middle" fill="var(--text-muted)">{relayText}</T>
        </g>

        {/* ---------- INA219 ---------- */}
        <g>
          {box(L.ina, supplyLost ? "var(--danger)" : "var(--border-strong)")}
          <T x={L.ina.x + L.ina.w / 2} y={L.ina.y + 20} size={12} weight={700} anchor="middle">INA219</T>
          {out ? (
            <>
              <T x={L.ina.x + L.ina.w / 2} y={L.ina.y + 39} size={13} weight={600} anchor="middle" mono fill={supplyLost ? "var(--danger)" : "var(--text)"}>
                {out.voltageV.toFixed(2)} V · {amps(out.currentA)}
              </T>
              <T x={L.ina.x + L.ina.w / 2} y={L.ina.y + 55} size={11} anchor="middle" fill="var(--text-subtle)" mono>
                {watts(out.powerW)}{out.fresh ? "" : " · stale"}
              </T>
            </>
          ) : (
            <T x={L.ina.x + L.ina.w / 2} y={L.ina.y + 44} size={12} anchor="middle" fill="var(--text-subtle)">no reading</T>
          )}
        </g>
        <T x={L.vertical ? L.busX - 24 : L.busX - 52} y={L.vertical ? L.busTop - 18 : L.busTop - 18} size={11} fill="var(--text-subtle)">Load rail</T>
        <circle cx={L.busX} cy={L.busTop} r={4} fill="var(--surface-solid)" stroke="var(--border-strong)" strokeWidth={1.5} />

        {/* ---------- four PWM branches ---------- */}
        {levels.map((b, i) => {
          const y = L.rows[i];
          const frac = totalW ? weights[i] / totalW : 0;
          const lit = trunkOn && b.on && !estop;
          const pct = Math.round((b.level * 100) / 255);
          const crit = essential.has(b.name);
          const ledW = L.led.w;
          const dBranch = `M ${L.busX} ${y} H ${L.mos.x}`;
          const dLed = `M ${L.mos.x + L.mos.w} ${y} H ${L.led.x}`;
          const lx = L.led.x;
          const ly = y - L.led.h / 2;
          const dots = L.vertical ? 6 : 4;
          return (
            <g key={b.name} opacity={b.fitted ? 1 : 0.4}>
              <circle cx={L.busX} cy={y} r={3.5} fill={lit ? toneVar[srcTone] : "var(--border-strong)"} />
              <Wire d={dBranch} on={lit} tone={srcTone} frac={clamp(frac * 1.6)} />
              <Wire d={dLed} on={lit} tone={srcTone} frac={clamp(frac * 1.6)} />

              <rect x={L.mos.x} y={y - L.mos.h / 2} width={L.mos.w} height={L.mos.h} rx={10} fill="var(--surface-solid)" stroke={lit ? toneVar[srcTone] : "var(--border-strong)"} strokeWidth={1.5} />
              <T x={L.mos.x + L.mos.w / 2} y={y - 5} size={11} weight={700} anchor="middle">MOSFET</T>
              <T x={L.mos.x + L.mos.w / 2} y={y + 13} size={12} anchor="middle" mono fill={b.on ? "var(--text)" : "var(--text-subtle)"}>
                PWM {pct}%
              </T>

              {/* LED module: glow scales with the reported duty, so a dimmed branch looks dimmed */}
              {lit && <rect x={lx + 8} y={ly + 8} width={ledW - 16} height={L.led.h - 16} rx={10} fill="var(--solar)" opacity={0.55 * (b.level / 255)} filter={`url(#${uid}-glow)`} />}
              <rect x={lx} y={ly} width={ledW} height={L.led.h} rx={12} fill="var(--surface-solid)" stroke={estop ? "var(--danger)" : lit ? "var(--solar)" : "var(--border-strong)"} strokeWidth={1.5} />
              {Array.from({ length: dots }, (_, k) => {
                const cx = lx + 18 + (k * (ledW - 36)) / (dots - 1);
                return <circle key={k} cx={cx} cy={ly + L.led.h - 16} r={4.5} fill={lit ? "var(--solar)" : "var(--border-strong)"} opacity={lit ? 0.25 + 0.75 * (b.level / 255) : 1} />;
              })}
              <T x={lx + 14} y={ly + 22} size={13} weight={700}>{b.name[0].toUpperCase() + b.name.slice(1)}</T>
              <T x={lx + ledW - 12} y={ly + 22} size={11} anchor="end" fill="var(--text-subtle)">
                {!b.fitted ? "not fitted" : crit ? "core" : estop ? "e-stop" : b.on ? "on" : "off"}
              </T>
              {mA(b.name) !== undefined && d.model?.confident && (
                <T x={lx + 14} y={ly + 38} size={11} fill="var(--text-subtle)" mono>{Math.round(mA(b.name)!)} mA full</T>
              )}
            </g>
          );
        })}

        {/* ---------- ESP32 and emergency stop ---------- */}
        <g>
          {box(L.esp, online ? "var(--ai)" : "var(--border-strong)")}
          <circle cx={L.esp.x + 18} cy={L.esp.y + 22} r={4.5} fill={online ? "var(--success)" : "var(--text-subtle)"} />
          <T x={L.esp.x + 32} y={L.esp.y + 27} weight={700}>ESP32</T>
          <T x={L.esp.x + L.esp.w - 14} y={L.esp.y + 27} size={11} anchor="end" fill="var(--text-subtle)" mono>{d.firmware ? `fw ${d.firmware}` : "firmware ?"}</T>
          <T x={L.esp.x + 14} y={L.esp.y + 50} size={12} fill="var(--text-muted)">
            {online ? `Wi-Fi · reported ${d.ageS !== null ? `${Math.round(d.ageS)} s` : "just"} ago` : known ? "Offline" : "Never seen"}
            {state.armed ? " · armed" : " · not armed"}
          </T>
        </g>
        <g>
          {box(L.estop, estop ? "var(--danger)" : "var(--border-strong)", estop ? "color-mix(in srgb, var(--danger) 14%, var(--surface-solid))" : "var(--surface-solid)")}
          <circle cx={L.estop.x + 26} cy={L.estop.y + L.estop.h / 2} r={11} fill={estop ? "var(--danger)" : "var(--surface-sunken)"} stroke={estop ? "var(--danger)" : "var(--border-strong)"} strokeWidth={2} />
          <T x={L.estop.x + 46} y={L.estop.y + L.estop.h / 2 - 2} size={12} weight={700} fill={estop ? "var(--danger)" : "var(--text)"}>E-stop</T>
          <T x={L.estop.x + 46} y={L.estop.y + L.estop.h / 2 + 14} size={11} fill={estop ? "var(--danger)" : "var(--text-subtle)"}>
            {estop ? "Latched: loads off" : "Ready"}
          </T>
        </g>

      </svg>
      <p className="mt-3 text-[13px] text-fg-subtle">
        The tabletop rig, as wired. Measured by the rig's own sensors: USB-level volts and milliamps, not campus kW. Control wires (relay coil, MOSFET gates) are left out.
      </p>
    </div>
  );
}
