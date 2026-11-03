// hi
/**
 * A faint campus silhouette standing on the backdrop's horizon: hostel blocks,
 * the labs, the library, a water tank, rooftop solar, a wind turbine and the
 * transmission line that feeds the campus. Decoration only (aria-hidden).
 * Colours come from tokens (--skyline, --window), so it follows the theme.
 */

// [x, width, height] of each building, in a 1440 x 180 drawing.
const BUILDINGS: [number, number, number][] = [
  [40, 70, 58], [118, 54, 84], [180, 90, 46], [300, 62, 102], [370, 48, 70],
  [520, 96, 64], [624, 40, 92], [672, 120, 54], [880, 66, 76], [954, 52, 118],
  [1014, 88, 60], [1170, 58, 88], [1236, 104, 50], [1348, 60, 72],
];

// Rows of lit windows, picked deterministically so they don't flicker.
function windows(x: number, w: number, h: number) {
  const out: { x: number; y: number }[] = [];
  for (let row = 10; row < h - 8; row += 13) {
    for (let col = 8; col < w - 8; col += 12) {
      const seed = Math.sin(x * 12.9898 + row * 78.233 + col * 37.719) * 43758.5453;
      if (seed - Math.floor(seed) < 0.32) out.push({ x: x + col, y: 180 - h + row });
    }
  }
  return out;
}

// Lattice transmission tower centred on x, base on the ground (y = 180).
function Pylon({ x, h = 120 }: { x: number; h?: number }) {
  const top = 180 - h;
  const arm1 = top + h * 0.16;
  const arm2 = top + h * 0.34;
  return (
    <g>
      <path
        d={`M${x - 16} 180 L${x - 4} ${top + 6} L${x} ${top} L${x + 4} ${top + 6} L${x + 16} 180
            M${x - 12} ${180 - h * 0.25} L${x + 12} ${180 - h * 0.25}
            M${x - 9} ${180 - h * 0.5} L${x + 9} ${180 - h * 0.5}
            M${x - 14} 180 L${x + 9} ${180 - h * 0.5} M${x + 14} 180 L${x - 9} ${180 - h * 0.5}
            M${x - 26} ${arm1} L${x + 26} ${arm1} M${x - 20} ${arm2} L${x + 20} ${arm2}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </g>
  );
}

const PYLONS = [{ x: 460, h: 128 }, { x: 800, h: 112 }, { x: 1110, h: 124 }, { x: 1410, h: 108 }];

export function CampusSkyline() {
  const wires: string[] = [];
  for (let k = 0; k < PYLONS.length - 1; k++) {
    const a = PYLONS[k];
    const b = PYLONS[k + 1];
    for (const [dy, dx] of [[0.16, 26], [0.34, 20]] as const) {
      for (const side of [-1, 1]) {
        const y1 = 180 - a.h + a.h * dy;
        const y2 = 180 - b.h + b.h * dy;
        const x1 = a.x + side * dx;
        const x2 = b.x + side * dx;
        const sag = (x2 - x1) * 0.06;
        wires.push(`M${x1} ${y1} Q${(x1 + x2) / 2} ${(y1 + y2) / 2 + sag} ${x2} ${y2}`);
      }
    }
  }

  return (
    <svg
      className="grid-backdrop__skyline"
      viewBox="0 0 1440 180"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
    >
      <g style={{ color: "var(--skyline)" }}>
        {BUILDINGS.map(([x, w, h]) => (
          <rect key={x} x={x} y={180 - h} width={w} height={h} rx="1.5" fill="currentColor" />
        ))}
        {/* library dome and lab chimney */}
        <path d="M672 126 a60 22 0 0 1 120 0 Z" fill="currentColor" />
        <rect x="984" y="40" width="8" height="24" fill="currentColor" />
        {/* water tank */}
        <path d="M232 134 h28 v14 h-28 Z M238 148 L234 180 M254 148 L258 180" fill="currentColor" stroke="currentColor" strokeWidth="2" />
        {/* rooftop solar rows */}
        <path d="M526 114 l14 -6 h22 l-14 6 Z M560 114 l14 -6 h22 l-14 6 Z M1240 128 l14 -6 h22 l-14 6 Z M1274 128 l14 -6 h22 l-14 6 Z" fill="currentColor" />
        {/* transmission line feeding the campus */}
        {PYLONS.map((p) => (
          <Pylon key={p.x} x={p.x} h={p.h} />
        ))}
        <path d={wires.join(" ")} fill="none" stroke="currentColor" strokeWidth="0.9" />
        {/* wind turbine with slowly turning blades */}
        <path d="M1302 180 L1305 64 L1307 64 L1310 180 Z" fill="currentColor" />
        <g className="grid-backdrop__rotor" style={{ transformOrigin: "1306px 62px" }}>
          <path d="M1306 62 L1303 20 L1306 18 L1309 20 Z M1306 62 L1342 82 L1342 86 L1338 85 Z M1306 62 L1270 82 L1270 86 L1274 85 Z" fill="currentColor" />
        </g>
        <circle cx="1306" cy="62" r="3" fill="currentColor" />
      </g>
      <g fill="var(--window)">
        {BUILDINGS.flatMap(([x, w, h]) =>
          windows(x, w, h).map((p) => <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width="5" height="4" rx="0.5" />),
        )}
      </g>
    </svg>
  );
}
