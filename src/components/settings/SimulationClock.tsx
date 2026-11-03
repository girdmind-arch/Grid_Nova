// hi
import { useState } from "react";
import { CloudSun } from "lucide-react";
import type { Environment } from "@/types/grid";
import { USE_MOCKS, ServiceError, setSimulation } from "@/services";
import { useAppStore } from "@/store/appStore";
import { useScenarioStore } from "@/store/scenarioStore";
import { SegmentedControl, toast } from "@/components/ui";
import { formatTime } from "@/utils/format";

type Clock = Environment["clock"];
const SPEEDS = ["1", "10", "60"] as const;

/** Live (real time + real weather) or a sped-up demo evening. Needs the live backend. */
export function SimulationClock() {
  const env = useAppStore((s) => s.environment);
  const setEnvironment = useAppStore((s) => s.setEnvironment);
  const [busy, setBusy] = useState(false);

  if (USE_MOCKS) {
    return (
      <p className="text-sm text-fg-muted">
        This copy runs on demo data with a fixed evening. Open the live site to run the campus on real time and real weather.
      </p>
    );
  }

  const apply = async (clock: Clock, speed: number) => {
    setBusy(true);
    try {
      const next = await setSimulation(clock, speed);
      setEnvironment(next);
      await useScenarioStore.getState().pulse();
      toast({
        title: clock === "live" ? "Live clock on" : `Demo evening at ${speed}×`,
        description:
          clock === "live"
            ? "The campus now follows real Indian time and today's weather."
            : "The campus restarts at 17:20 with today's weather. Watch the evening peak arrive.",
        tone: "ai",
      });
    } catch (e) {
      toast({ title: "The clock could not be changed.", description: e instanceof ServiceError ? e.message : "Try again.", tone: "warning" });
    } finally {
      setBusy(false);
    }
  };

  const clock: Clock = env?.clock ?? "live";
  const speed = String(env?.speed ?? 1);
  const live = env?.weatherSource === "open-meteo";

  return (
    <div className={busy ? "pointer-events-none opacity-60" : undefined}>
      <SegmentedControl<Clock>
        label="Simulation clock"
        value={clock}
        onChange={(v) => void apply(v, v === "demo" ? 60 : 1)}
        className="w-full"
        options={[
          { value: "live", label: "Live" },
          { value: "demo", label: "Demo evening" },
        ]}
      />
      {clock === "demo" && (
        <div className="mt-3">
          <p className="mb-1.5 text-[13px] text-fg-muted">Speed</p>
          <SegmentedControl<(typeof SPEEDS)[number]>
            label="Demo speed"
            value={(SPEEDS as readonly string[]).includes(speed) ? (speed as (typeof SPEEDS)[number]) : "60"}
            onChange={(v) => void apply("demo", Number(v))}
            className="w-full"
            options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
          />
        </div>
      )}
      <p className="mt-4 flex items-start gap-2 text-sm text-fg-muted">
        <CloudSun aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-solar" />
        <span>
          {live ? (
            <>
              Live weather for {env?.location} from Open-Meteo
              {env?.weatherUpdatedAt && <>, updated {formatTime(env.weatherUpdatedAt)}</>}.
            </>
          ) : (
            "Weather service unreachable: using a typical hot-day profile."
          )}
        </span>
      </p>
    </div>
  );
}
