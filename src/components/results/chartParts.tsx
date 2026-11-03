// hi
import type { ReactNode } from "react";
import type { ResultsSeriesPoint } from "@/types/agents";
import { cn } from "@/utils/cn";

// Shared pieces for the Results charts. Colors come from the chart tokens, so
// both themes work without any per-theme code (SVG attributes accept var()).

export type SeriesKey = "gridnova" | "baseline";

export const SERIES: { key: SeriesKey; name: string; color: string }[] = [
  { key: "gridnova", name: "GridNova", color: "var(--chart-1)" },
  { key: "baseline", name: "No-AI baseline", color: "var(--chart-2)" },
];

/** Axis and grid styling, shared so every chart looks the same. */
export const AXIS_TICK = { fill: "var(--text-subtle)", fontSize: 12, fontFamily: "var(--font-mono)" };
export const GRID_STROKE = "var(--chart-grid)";

/** Legend above a chart: a colored key beside plain text (text never wears the series color). */
export function SeriesLegend({ shape = "square" }: { shape?: "square" | "line" }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-fg-muted">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("shrink-0", shape === "line" ? "h-0.5 w-4 rounded-full" : "size-3 rounded-[3px]")}
            style={{ background: s.color }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
}

/** Hover card for every chart: both values, plus how much less GridNova used. */
export function makeTooltip(format: (n: number) => string, labelPrefix = "") {
  return function ChartTooltip({ active, payload, label }: TooltipProps) {
    if (!active || !payload?.length) return null;
    const value = (key: SeriesKey) => Number(payload.find((p) => p.dataKey === key)?.value ?? 0);
    const gm = value("gridnova");
    const base = value("baseline");
    const less = base > 0 ? Math.round((1 - gm / base) * 100) : 0;
    return (
      <div className="min-w-44 glass-strong rounded-md border border-glass-border bg-surface-solid/92 px-3 py-2.5 text-sm shadow-md">
        <p className="mb-1.5 font-semibold text-fg">
          {labelPrefix}
          {label}
        </p>
        {SERIES.map((s) => (
          <p key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-fg-muted">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.name}
            </span>
            <span className="font-mono font-semibold tabular text-fg">{format(s.key === "gridnova" ? gm : base)}</span>
          </p>
        ))}
        {less > 0 && <p className="mt-1.5 border-t border-border pt-1.5 text-[13px] font-medium text-success">{less}% less with GridNova</p>}
      </div>
    );
  };
}

/** The same numbers as a table, for screen readers and anyone who prefers rows. */
export function ChartTable({
  rows,
  labelHeader,
  format,
}: {
  rows: ResultsSeriesPoint[];
  labelHeader: string;
  format: (n: number) => string;
}) {
  return (
    <details className="group mt-4">
      <summary className="print:hidden inline-flex h-9 cursor-pointer items-center rounded-sm text-sm font-semibold text-accent hover:text-accent-hover pointer-coarse:h-11">
        <span className="group-open:hidden">Show as table</span>
        <span className="hidden group-open:inline">Hide table</span>
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-fg-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {labelHeader}
              </th>
              {SERIES.map((s) => (
                <th key={s.key} scope="col" className="py-2 pl-3 text-right font-semibold">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-border last:border-0">
                <th scope="row" className="py-2 pr-3 text-left font-medium text-fg">
                  {r.label}
                </th>
                <td className="py-2 pl-3 text-right font-mono tabular text-fg">{format(r.gridnova)}</td>
                <td className="py-2 pl-3 text-right font-mono tabular text-fg-muted">{format(r.baseline)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Card frame for one metric: title, one-line explanation, legend, chart, table. */
export function ChartCard({
  title,
  description,
  icon,
  legendShape,
  children,
  table,
  className,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  legendShape?: "square" | "line";
  children: ReactNode;
  table: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0 break-inside-avoid rounded-lg border border-border bg-surface p-5 shadow-sm sm:p-6 print:shadow-none", className)}>
      <div className="flex items-center gap-2.5">
        {icon}
        <h2 className="text-base font-semibold text-fg">{title}</h2>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{description}</p>
      <div className="mt-4">
        <SeriesLegend shape={legendShape} />
      </div>
      {/* Figure is decorative for screen readers; the table carries the values. */}
      <div className="mt-3" aria-hidden>
        {children}
      </div>
      {table}
    </section>
  );
}
