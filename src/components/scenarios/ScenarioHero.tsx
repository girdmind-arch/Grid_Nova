// hi
import { ArrowRight, Play } from "lucide-react";
import { Button, Card } from "@/components/ui";

const STEPS = ["Break something", "Agents detect it", "Test a fix in the digital twin", "Grid heals"];

/** Scenarios page hero: what happens when you run one, plus the recommended first demo. */
export function ScenarioHero({ onTry, disabled }: { onTry: () => void; disabled?: boolean }) {
  return (
    <Card variant="hero" padding="lg">
      <h2 className="max-w-2xl text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">
        Break the grid on purpose. Watch it heal itself.
      </h2>
      <ol className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px] font-medium">
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-white/18 font-mono text-xs font-semibold">{i + 1}</span>
            {step}
            {i < STEPS.length - 1 && <ArrowRight aria-hidden className="size-4 text-hero-text-muted" />}
          </li>
        ))}
      </ol>
      <p className="mt-4 max-w-xl text-[15px] text-hero-text-muted">
        Then replay it: the agents remember the last run and recover faster.
      </p>
      <Button variant="onHero" size="lg" className="mt-6" onClick={onTry} disabled={disabled}>
        <Play /> Try a line failure
      </Button>
    </Card>
  );
}
