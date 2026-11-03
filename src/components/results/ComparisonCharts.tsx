// hi
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock3, IndianRupee, TrendingDown } from "lucide-react";
import type { ResultsSeriesPoint } from "@/types/agents";
import { IconTile } from "@/components/ui";
import { formatInr, formatKw, formatNumber } from "@/utils/format";
import { AXIS_TICK, ChartCard, ChartTable, GRID_STROKE, SERIES, makeTooltip } from "./chartParts";

// One chart per headline metric. Same marks everywhere: bars ≤24px with a 4px
// rounded end, 2px lines, 8px dots with a surface ring, solid hairline grid.

const inrK = (n: number) => (n === 0 ? "₹0" : `₹${formatNumber(n / 1000)}K`);
const minutes = (n: number) => `${formatNumber(n, 1)} min`;

const CostTooltip = makeTooltip(formatInr);
const PeakTooltip = makeTooltip(formatKw);
const RecoveryTooltip = makeTooltip(minutes);

/** Electricity bill per day, last school week. Grouped columns. */
export function CostChart({ data }: { data: ResultsSeriesPoint[] }) {
  // Round the axis up to a clean step (₹20K below ₹1 lakh, ₹50K above).
  const top = Math.max(...data.flatMap((d) => [d.gridnova, d.baseline]));
  const stepInr = top > 100_000 ? 50_000 : 20_000;
  const costMax = Math.ceil(top / stepInr) * stepInr;
  const costTicks = Array.from({ length: costMax / stepInr + 1 }, (_, i) => i * stepInr);
  return (
    <ChartCard
      title="Electricity cost per day"
      description="The same five weekdays (4–8 May), simulated with and without the agents."
      icon={<IconTile icon={<IndianRupee />} tone="success" size="sm" />}
      table={<ChartTable rows={data} labelHeader="Day" format={formatInr} />}
    >
      <ResponsiveContainer width="100%" height={248}>
        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontFamily: "var(--font-sans)", fontSize: 13 }} tickLine={false} axisLine={{ stroke: GRID_STROKE }} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={inrK} width={56} domain={[0, costMax]} ticks={costTicks} />
          <Tooltip content={CostTooltip} cursor={{ fill: "var(--surface-sunken)" }} />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Campus demand through the evening peak. Two lines; the 19:00 peak is labelled. */
export function PeakChart({ data }: { data: ResultsSeriesPoint[] }) {
  // Label only the highest point of each line (the numbers the headline compares).
  const peakOf = (key: "gridnova" | "baseline") => data.reduce((a, b) => (b[key] > a[key] ? b : a)).label;
  const peaks = { gridnova: peakOf("gridnova"), baseline: peakOf("baseline") };

  return (
    <ChartCard
      title="Demand in the evening peak"
      description="Battery discharge and hostel pre-cooling flatten the 18:00–22:00 peak."
      icon={<IconTile icon={<TrendingDown />} tone="accent" size="sm" />}
      legendShape="line"
      table={<ChartTable rows={data} labelHeader="Hour" format={formatKw} />}
    >
      <ResponsiveContainer width="100%" height={248}>
        <LineChart data={data} margin={{ top: 24, right: 16, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} padding={{ left: 12, right: 12 }} />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={[0, 1600]}
            ticks={[0, 400, 800, 1200, 1600]}
            tickFormatter={(n: number) => formatNumber(n)}
          />
          <Tooltip content={PeakTooltip} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey={s.key}
                position={s.key === "baseline" ? "top" : "bottom"}
                offset={10}
                content={(props) => {
                  const { x, y, value, index } = props as { x?: number; y?: number; value?: number; index?: number };
                  if (index === undefined || data[index]?.label !== peaks[s.key] || x === undefined || y === undefined) return null;
                  const dy = s.key === "baseline" ? -12 : 22;
                  return (
                    <text x={x} y={y + dy} textAnchor="middle" fill="var(--text)" fontSize={12} fontWeight={600} fontFamily="var(--font-mono)">
                      {formatNumber(Number(value))} kW
                    </text>
                  );
                }}
              />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Minutes from fault to a stable grid, per scenario. Horizontal bars, value at the tip. */
export function RecoveryChart({ data }: { data: ResultsSeriesPoint[] }) {
  return (
    <ChartCard
      title="Fault recovery time"
      description="Minutes from fault to a stable grid in each scenario, measured in the digital twin."
      icon={<IconTile icon={<Clock3 />} tone="accent" size="sm" />}
      table={<ChartTable rows={data} labelHeader="Scenario" format={minutes} />}
    >
      <ResponsiveContainer width="100%" height={264}>
        <BarChart data={data} layout="vertical" barGap={2} barCategoryGap="24%" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} domain={[0, 24]} ticks={[0, 6, 12, 18, 24]} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ ...AXIS_TICK, fill: "var(--text-muted)", fontFamily: "var(--font-sans)", fontSize: 13 }}
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            width={92}
          />
          <Tooltip content={RecoveryTooltip} cursor={{ fill: "var(--surface-sunken)" }} />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList
                dataKey={s.key}
                position="right"
                offset={6}
                formatter={(v: unknown) => formatNumber(Number(v), 1)}
                style={{ fill: s.key === "gridnova" ? "var(--text)" : "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600 }}
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
