// hi
import { useState } from "react";
import { Clock3, Download, IndianRupee, TrendingDown } from "lucide-react";
import type { Results as ResultsData } from "@/types/agents";
import { getResults } from "@/services";
import { useService } from "@/hooks/useService";
import { Button, ErrorState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import { ResultsHero } from "@/components/results/ResultsHero";
import { CostChart, PeakChart, RecoveryChart } from "@/components/results/ComparisonCharts";
import { WhatIfPanel } from "@/components/results/WhatIfPanel";
import { formatDate, formatNumber } from "@/utils/format";
import { simNow } from "@/utils/simTime";
import { printPage } from "@/utils/printPage";

export default function Results() {
  const results = useService(getResults);
  // A what-if run replaces the numbers until the operator goes back to the real campus.
  const [whatIf, setWhatIf] = useState<ResultsData | null>(null);
  const base = whatIf ?? results.data;
  const data = base && whatIf?.settings
    ? {
        ...base,
        dataNote: `What-if: ${whatIf.settings.batteryKwh === 0 ? "no battery" : `${formatNumber(whatIf.settings.batteryKwh / 1000, 2)} MWh battery`}, ${whatIf.settings.solarPct}% solar, peak ₹${whatIf.settings.peakRate.toFixed(2)}/kWh${whatIf.settings.tempOffsetC ? `, ${whatIf.settings.tempOffsetC > 0 ? "+" : ""}${whatIf.settings.tempOffsetC}°C` : ""}`,
      }
    : base;

  return (
    <>
      {/* Only in the PDF: says what the document is when it is read away from the app. */}
      <p className="mb-4 hidden text-sm text-fg-muted print:block">
        GridNova · Results report · BITSETGO'26 · Simulated campus, {formatDate(simNow())} 2026
      </p>

      <PageHeader
        title="Results"
        description="GridNova compared with a no-AI baseline on the same simulated campus."
        actions={
          data && (
            <Button variant="secondary" onClick={printPage} className="print:hidden" title="Opens the print dialog. Choose “Save as PDF”.">
              <Download /> Save as PDF
            </Button>
          )
        }
      />

      {results.status === "error" && !data && <ErrorState message={results.error} onRetry={results.retry} />}

      {!data && results.status === "loading" && (
        <div className="space-y-6">
          <Skeleton className="h-80" />
          <Skeleton className="h-96" />
        </div>
      )}

      {data && (
        <>
          <ResultsHero results={data} />
          {/* One chart at a time on screen; the PDF prints all three. */}
          <Tabs defaultValue="cost" className="mt-6">
            <TabsList aria-label="Compare" className="print:hidden">
              <TabsTrigger value="cost">
                <IndianRupee strokeWidth={1.75} /> Cost
              </TabsTrigger>
              <TabsTrigger value="peak">
                <TrendingDown strokeWidth={1.75} /> Peak
              </TabsTrigger>
              <TabsTrigger value="recovery">
                <Clock3 strokeWidth={1.75} /> Recovery
              </TabsTrigger>
            </TabsList>
            {(
              [
                ["cost", <CostChart data={data.cost} />],
                ["peak", <PeakChart data={data.peak} />],
                ["recovery", <RecoveryChart data={data.recovery} />],
              ] as const
            ).map(([value, chart]) => (
              <TabsContent key={value} value={value} forceMount className="data-[state=inactive]:hidden print:mt-6 print:data-[state=inactive]:block">
                {chart}
              </TabsContent>
            ))}
          </Tabs>
          <div className="mt-6">
            <WhatIfPanel
              key={results.data?.settings ? JSON.stringify(results.data.settings) : "default"}
              defaults={results.data?.settings}
              onResults={(r) => setWhatIf(r)}
            />
          </div>
        </>
      )}
    </>
  );
}
