// hi
import { Battery, BatteryCharging, BedDouble, Cpu, House, Landmark, Library, Presentation, SunMedium, UtilityPole } from "lucide-react";
import type { GridState, Zone, ZoneKind } from "@/types/grid";
import { useElementWidth } from "@/hooks/useElementWidth";
import { formatKw, formatNumber } from "@/utils/format";
import { cn } from "@/utils/cn";
import { GridNode, type NodeState } from "./GridNode";
import { PowerFlowLine, type FlowTone } from "./PowerFlowLine";

// Live grid diagram. Layout (any width):
//
//      [ Solar ]   [ Battery ]   [ Grid ]        sources
//          │            │           │
//      ────┴────────────┼───────────┴────        campus bus
//                       │
//      [ BH1     ] ─────┼───── [ Electrical Lab ]   zones on both sides of a
//      [ BH2     ] ─────┼───── [ CS Lab         ]   vertical feeder spine:
//      [ GH1     ] ─────┼───── [ Library        ]   left = where people live,
//      [ GH2     ] ─────┼───── [ Lecture Thtrs  ]   right = academic + admin
//      [ Faculty ] ─────┴───── [ Admin          ]
//
// Lines are SVG, boxes are HTML (real text sizes, accessible), both positioned
// from the measured container width.

const ZONE_ICONS: Record<ZoneKind, typeof BedDouble> = {
  hostel: BedDouble,
  lab: Cpu,
  library: Library,
  admin: Landmark,
  academic: Presentation,
  residence: House,
};

/** Routine evening pre-cooling is a saving, not a problem: say so instead of "Reduced". */
const isPeakSaving = (z: Zone) => z.status === "reduced" && !!z.note?.startsWith("Pre-cool");
const isRerouted = (z: Zone) => z.status === "reduced" && !!z.note?.includes("backup feeder");

const zoneState = (z: Zone): NodeState =>
  z.status === "faulted" || z.status === "isolated" ? "faulted" : z.status === "reduced" && !isPeakSaving(z) ? "reduced" : "normal";

interface Layout {
  W: number;
  H: number;
  narrow: boolean;
  src: { x: number; y: number; w: number; h: number }[];
  busY: number;
  spineX: number;
  zone: { x: number; y: number; w: number; h: number; left: boolean }[];
}

/** Two columns of five buildings. */
const ROWS = 5;
const ZONE_SLOTS = ROWS * 2;

function computeLayout(W: number): Layout {
  const narrow = W < 560;
  const gap = narrow ? 8 : 16;
  const srcH = narrow ? 64 : 72;
  const srcW = (W - 2 * gap) / 3;
  const src = [0, 1, 2].map((i) => ({ x: i * (srcW + gap), y: 0, w: srcW, h: srcH }));

  const busY = srcH + (narrow ? 32 : 40);
  const spineX = W / 2;
  const spineGap = narrow ? 36 : Math.min(140, W * 0.16);
  const colW = (W - spineGap) / 2;
  const zoneH = narrow ? 76 : 64;
  const rowGap = narrow ? 10 : 12;
  const firstRowY = busY + (narrow ? 28 : 32);

  const zone = Array.from({ length: ZONE_SLOTS }, (_, i) => {
    const left = i < ROWS;
    const row = i % ROWS;
    return { x: left ? 0 : W - colW, y: firstRowY + row * (zoneH + rowGap), w: colW, h: zoneH, left };
  });
  const H = firstRowY + ROWS * zoneH + (ROWS - 1) * rowGap + 2;
  return { W, H, narrow, src, busY, spineX, zone };
}

export function GridDiagram({ state, className }: { state: GridState; className?: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const L = width > 0 ? computeLayout(width) : null;

  const outage = state.activeFault?.type === "grid_outage";
  const batteryKw = Math.max(0, -state.battery.powerKw); // discharging into the campus
  const chargingKw = Math.max(0, state.battery.powerKw); // charging from the bus
  const maxKw = Math.max(400, state.demandKw / 2);

  // Left column: hostels and the faculty compound; right: labs, library, lecture theatres, admin.
  const residential = (z: Zone) => z.kind === "hostel" || z.kind === "residence";
  const ordered = [...state.zones.filter(residential), ...state.zones.filter((z) => !residential(z))].slice(0, ZONE_SLOTS);

  const sources: { key: string; name: string; value: string; sub: string; kw: number; tone: FlowTone; icon: React.ReactNode; iconTone: "solar" | "success" | "accent"; state: NodeState }[] = [
    {
      key: "solar",
      name: "Solar",
      value: formatKw(state.solarKw),
      sub: state.solarKw > 0 ? "Generating" : "No output",
      kw: state.solarKw,
      tone: "solar",
      icon: <SunMedium />,
      iconTone: "solar",
      state: "normal",
    },
    {
      key: "battery",
      name: "Battery",
      value: `${state.battery.socPct}%`,
      sub: batteryKw > 0 ? `Supplying ${formatKw(batteryKw)}` : chargingKw > 0 ? `Charging ${formatKw(chargingKw)}` : "Standby · ready",
      kw: batteryKw || chargingKw,
      tone: "battery",
      icon: batteryKw > 0 ? <Battery /> : <BatteryCharging />,
      iconTone: "success",
      state: "normal",
    },
    {
      key: "grid",
      name: "Main grid",
      value: outage ? "Offline" : formatKw(state.gridImportKw),
      sub: outage ? "Supply lost" : `₹${state.tariff.ratePerKwh.toFixed(2)}/kWh`,
      kw: state.gridImportKw,
      tone: outage ? "fault" : "grid",
      icon: <UtilityPole />,
      iconTone: "accent",
      state: outage ? "faulted" : "normal",
    },
  ];

  const summary =
    `Solar ${formatKw(state.solarKw)}, battery ${batteryKw ? `supplying ${formatKw(batteryKw)}` : chargingKw ? `charging ${formatKw(chargingKw)}` : "on standby"}, ` +
    `grid ${outage ? "offline" : formatKw(state.gridImportKw)}. ` +
    ordered.map((z) => `${z.name} ${formatKw(z.demandKw)}${z.status !== "normal" ? ` (${z.status})` : ""}`).join(", ") +
    ".";

  return (
    <figure className={cn("m-0", className)}>
      <figcaption className="sr-only">Live grid diagram. {summary}</figcaption>
      <div ref={ref} aria-hidden className="relative w-full" style={{ height: L?.H ?? 500 }}>
        {L && (
          <>
            <svg width={L.W} height={L.H} className="absolute inset-0 overflow-visible" role="presentation">
              {/* campus bus + feeder spine */}
              <path
                d={`M ${L.src[0].x + L.src[0].w / 2} ${L.busY} L ${L.src[2].x + L.src[2].w / 2} ${L.busY} M ${L.spineX} ${L.busY} L ${L.spineX} ${L.zone[ROWS - 1].y + L.zone[ROWS - 1].h / 2}`}
                stroke="var(--border-strong)"
                strokeWidth={6}
                strokeLinecap="round"
                fill="none"
              />
              {sources.map((s, i) => (
                <PowerFlowLine
                  key={s.key}
                  x1={L.src[i].x + L.src[i].w / 2}
                  y1={L.src[i].h}
                  x2={L.src[i].x + L.src[i].w / 2}
                  y2={L.busY}
                  kw={s.kw}
                  maxKw={maxKw}
                  tone={s.tone}
                  reverse={s.key === "battery" && chargingKw > 0}
                />
              ))}
              {ordered.map((z, i) => {
                const box = L.zone[i];
                const cy = box.y + box.h / 2;
                const edge = box.left ? box.x + box.w : box.x;
                const faulted = z.status === "faulted" || z.status === "isolated";
                return (
                  <PowerFlowLine
                    key={z.id}
                    x1={L.spineX}
                    y1={cy}
                    x2={edge}
                    y2={cy}
                    kw={z.demandKw}
                    maxKw={maxKw / 2}
                    tone={faulted ? "fault" : isRerouted(z) ? "reroute" : "zone"}
                  />
                );
              })}
            </svg>

            {sources.map((s, i) => (
              <GridNode
                key={s.key}
                name={s.name}
                value={s.value}
                sub={L.narrow ? undefined : s.sub}
                icon={s.icon}
                tone={s.iconTone}
                state={s.state}
                compact={L.narrow}
                style={{ left: L.src[i].x, top: L.src[i].y, width: L.src[i].w, height: L.src[i].h }}
              />
            ))}

            {/* Total load label sitting on the bus */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-fg-muted shadow-sm"
              style={{ left: L.spineX, top: L.busY }}
            >
              Campus load <span className="font-mono text-fg tabular">{formatNumber(state.demandKw)} kW</span>
            </div>

            {ordered.map((z, i) => {
              const Icon = ZONE_ICONS[z.kind];
              const box = L.zone[i];
              return (
                <GridNode
                  key={z.id}
                  name={z.name}
                  value={formatKw(z.demandKw)}
                  sub={L.narrow ? undefined : z.note}
                  icon={<Icon />}
                  tone={z.kind === "lab" ? "success" : z.kind === "hostel" ? "accent" : "neutral"}
                  state={zoneState(z)}
                  protectedZone={z.priority === "critical"}
                  label={
                    isPeakSaving(z)
                      ? { text: "Peak saving", tone: "neutral" }
                      : isRerouted(z)
                        ? { text: "Rerouted", tone: "ai" }
                        : undefined
                  }
                  compact={L.narrow}
                  style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                />
              );
            })}

            {/* Tag the backup path so the reroute is obvious */}
            {ordered.map((z, i) => {
              if (!isRerouted(z) || L.narrow) return null;
              const box = L.zone[i];
              const edge = box.left ? box.x + box.w : box.x;
              return (
                <div
                  key={`${z.id}-f2`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 animate-pop-in rounded-full border border-ai/40 bg-surface px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-ai shadow-sm"
                  style={{ left: (L.spineX + edge) / 2, top: box.y + box.h / 2 }}
                >
                  via F2
                </div>
              );
            })}
          </>
        )}
      </div>
    </figure>
  );
}

export function GridLegend({ className }: { className?: string }) {
  const item = (color: string, label: string, dashed?: boolean) => (
    <li className="flex items-center gap-2">
      <svg aria-hidden width="22" height="8">
        <path d="M2 4 L20 4" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={dashed ? "3 4" : undefined} />
      </svg>
      {label}
    </li>
  );
  return (
    <ul className={cn("flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-fg-muted", className)}>
      {item("var(--solar)", "Solar")}
      {item("var(--success)", "Battery")}
      {item("var(--accent)", "Grid / campus feeders")}
      {item("var(--danger)", "Fault", true)}
      {item("var(--ai)", "Backup feeder")}
      <li>Thicker line = more power</li>
    </ul>
  );
}
