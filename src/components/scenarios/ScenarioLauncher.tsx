// hi
import { useId, useState } from "react";
import { MonitorPlay, Shuffle, Square, Wand2 } from "lucide-react";
import type { FaultType } from "@/types/grid";
import { useScenarioStore } from "@/store/scenarioStore";
import { Button, Card } from "@/components/ui";
import { cn } from "@/utils/cn";
import { EXAMPLES, parseScenario } from "./parseScenario";
import { SCENARIOS, SCENARIO_ORDER } from "./scenarioMeta";

const SEVERITY = ["Mild", "Light", "Moderate", "Strong", "Severe"];

interface ScenarioLauncherProps {
  onRun: (type: FaultType, severity: number, durationMin: number) => void;
  disabled?: boolean;
  className?: string;
}

/** Three quick ways in: describe a problem, a random one, or the full presentation tour. */
export function ScenarioLauncher({ onRun, disabled, className }: ScenarioLauncherProps) {
  const touring = useScenarioStore((s) => s.touring);
  const startTour = useScenarioStore((s) => s.startTour);
  const stopTour = useScenarioStore((s) => s.stopTour);
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inputId = useId();
  const noteId = useId();

  const submit = (value = text) => {
    const parsed = parseScenario(value);
    if (!parsed) {
      setNote({ tone: "error", text: "No scenario found in that. Try words like clouds, heatwave, cable, or blackout." });
      return;
    }
    const also = parsed.alsoMentioned.map((t) => SCENARIOS[t].title.toLowerCase());
    setNote({
      tone: "ok",
      text:
        `Understood as ${SCENARIOS[parsed.type].title} · ${SEVERITY[parsed.severity - 1]} · ${parsed.durationMin} min.` +
        (also.length ? ` GridNova handles one fault at a time, so ${also.join(" and ")} can run next.` : ""),
    });
    onRun(parsed.type, parsed.severity, parsed.durationMin);
  };

  const surprise = () => {
    const type = SCENARIO_ORDER[Math.floor(Math.random() * SCENARIO_ORDER.length)];
    const severity = 2 + Math.floor(Math.random() * 4); // 2–5
    const durationMin = [15, 30, 60][Math.floor(Math.random() * 3)];
    setNote({ tone: "ok", text: `Surprise: ${SCENARIOS[type].title} · ${SEVERITY[severity - 1]} · ${durationMin} min.` });
    onRun(type, severity, durationMin);
  };

  return (
    <Card className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Wand2 aria-hidden className="size-4 text-ai" /> Describe a problem
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id={inputId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Severe heatwave during exam night"
            aria-describedby={note ? noteId : undefined}
            disabled={disabled}
            className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-[15px] text-fg placeholder:text-fg-subtle focus-visible:border-accent focus-visible:outline-none disabled:opacity-60"
          />
          <Button type="submit" variant="primary" disabled={disabled || !text.trim()}>
            Break it
          </Button>
        </div>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={disabled}
            onClick={() => {
              setText(ex);
              submit(ex);
            }}
            className="rounded-full border border-border bg-surface-sunken px-2.5 py-1 text-[13px] text-fg-muted hover:border-border-strong hover:text-fg disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {note && (
        <p id={noteId} role="status" className={cn("mt-2.5 text-[13px]", note.tone === "error" ? "text-danger" : "text-fg-muted")}>
          {note.text}
        </p>
      )}
      <p className="mt-1 text-xs text-fg-subtle">Matched by keywords in your browser. The agents' response comes from the backend.</p>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button size="sm" onClick={surprise} disabled={disabled}>
          <Shuffle /> Surprise me
        </Button>
        {touring ? (
          <Button size="sm" variant="ghost" onClick={stopTour}>
            <Square /> Stop presentation
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void startTour()}
            disabled={disabled}
          >
            <MonitorPlay /> Presentation mode
          </Button>
        )}
      </div>
    </Card>
  );
}
