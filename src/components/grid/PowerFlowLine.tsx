// hi
// One power line in the grid diagram (an SVG <g>).
// Thickness shows how much power flows; moving dashes show the direction.
// An idle line stays solid (connected, just no flow right now).
// A faulted line turns red, stops moving and shows a break.

export type FlowTone = "solar" | "battery" | "grid" | "zone" | "fault" | "reroute";

const toneColor: Record<FlowTone, string> = {
  solar: "var(--solar)",
  battery: "var(--success)",
  grid: "var(--accent)",
  zone: "var(--accent)",
  fault: "var(--danger)",
  /** Power restored through a backup feeder after a fault. */
  reroute: "var(--ai)",
};

interface PowerFlowLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kw: number;
  /** kW that maps to the thickest line. */
  maxKw: number;
  tone: FlowTone;
  /** Power flows from (x2, y2) to (x1, y1), e.g. a battery charging from the bus. */
  reverse?: boolean;
}

export function strokeFor(kw: number, maxKw: number) {
  return 2 + 6 * Math.sqrt(Math.min(kw, maxKw) / maxKw);
}

export function PowerFlowLine({ x1, y1, x2, y2, kw, maxKw, tone, reverse }: PowerFlowLineProps) {
  const d = reverse ? `M ${x2} ${y2} L ${x1} ${y1}` : `M ${x1} ${y1} L ${x2} ${y2}`;

  if (tone === "fault") {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return (
      <g>
        <path d={d} stroke={toneColor.fault} strokeWidth={2.5} strokeDasharray="4 5" strokeLinecap="round" fill="none" opacity={0.85} />
        {/* the break */}
        <circle cx={mx} cy={my} r={9} fill="var(--surface)" stroke={toneColor.fault} strokeWidth={2} />
        <path
          d={`M ${mx - 3.5} ${my - 3.5} L ${mx + 3.5} ${my + 3.5} M ${mx + 3.5} ${my - 3.5} L ${mx - 3.5} ${my + 3.5}`}
          stroke={toneColor.fault}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </g>
    );
  }

  if (kw <= 0) {
    // Connected but idle (e.g. battery on standby): a solid, quiet line.
    return <path d={d} stroke="var(--border-strong)" strokeWidth={3} strokeLinecap="round" fill="none" />;
  }

  const width = strokeFor(kw, maxKw);
  return (
    <g>
      <path d={d} stroke={toneColor[tone]} strokeOpacity={0.22} strokeWidth={width} strokeLinecap="round" fill="none" />
      <path
        className="power-flow"
        d={d}
        stroke={toneColor[tone]}
        strokeWidth={Math.max(2, width * 0.55)}
        strokeDasharray="6 10"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}
