// hi
import { Link } from "react-router";
import { FlaskConical, Play } from "lucide-react";
import type { Results } from "@/types/agents";
import { Button, Card } from "@/components/ui";
import { useCountUp } from "@/hooks/useCountUp";
import { formatNumber } from "@/utils/format";

function HeroNumber({ value, digits, unit, label, note }: { value: number; digits: number; unit: string; label: string; note: string }) {
  const animated = useCountUp(value);
  return (
    <div className="min-w-0">
      <dt className="text-[15px] font-semibold">{label}</dt>
      <dd className="mt-1">
        <span className="font-mono text-[44px] leading-none font-semibold tracking-[-0.04em] sm:text-[52px]">
          {formatNumber(animated, digits)}
        </span>
        <span className="ml-1 text-xl font-semibold">{unit}</span>
        <span className="sr-only">
          {formatNumber(value, digits)} {unit}
        </span>
        <p className="mt-2 text-sm text-hero-text-muted">{note}</p>
      </dd>
    </div>
  );
}

/** The judge screen hero: three headline numbers vs. the no-AI baseline. */
export function ResultsHero({ results }: { results: Results }) {
  const { costSavedPct, peakReducedPct, recovery } = results.headline;
  const faster = recovery.baselineMin / recovery.gridnovaMin;

  return (
    <Card variant="hero" padding="lg">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/16 px-3 py-1 text-[13px] font-semibold">
        <FlaskConical aria-hidden className="size-3.5" strokeWidth={1.75} />
        {results.dataNote}
      </span>
      <h2 className="mt-4 max-w-2xl text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
        Same campus, same weather. GridNova spends less and recovers faster.
      </h2>

      <dl className="mt-7 grid gap-x-10 gap-y-6 sm:grid-cols-3">
        <HeroNumber value={costSavedPct} digits={1} unit="%" label="Lower electricity cost" note="Across five simulated weekdays" />
        <HeroNumber value={peakReducedPct} digits={1} unit="%" label="Lower evening peak" note="Highest grid import of the day" />
        <HeroNumber
          value={recovery.gridnovaMin}
          digits={1}
          unit="min"
          label="Fault recovery"
          note={`vs ${formatNumber(recovery.baselineMin)} min without AI (${formatNumber(faster, 0)}× faster)`}
        />
      </dl>

      <Button asChild variant="onHero" size="lg" className="mt-8 print:hidden">
        <Link to="/app/scenarios">
          <Play /> Test it with a scenario
        </Link>
      </Button>
    </Card>
  );
}
