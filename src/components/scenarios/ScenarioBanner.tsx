import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CircleCheck, Hand, RotateCcw, Timer, Volume2, VolumeX } from "lucide-react";
import { useScenarioStore } from "@/store/scenarioStore";
import { Badge, Button, IconTile } from "@/components/ui";
import { formatNumber } from "@/utils/format";
import { cn } from "@/utils/cn";
import { setSoundEnabled, soundEnabled } from "@/utils/sound";
import { SCENARIOS } from "./scenarioMeta";
import { RigStatus } from "./RigStatus";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Live elapsed time since the scenario started; stops once the grid is stable. */
function useElapsed(startedAtMs: number, stoppedAtMs: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (stoppedAtMs) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [stoppedAtMs]);
  return mmss((stoppedAtMs ?? now) - startedAtMs);
}

/**
 * Calm alert shown while a scenario runs: what happened, what the agents are
 * doing, and how long recovery took. Offers "Replay" once stable.
 */
export function ScenarioBanner({ className }: { className?: string }) {
  const active = useScenarioStore((s) => s.active);
  const phase = useScenarioStore((s) => s.phase);
  const history = useScenarioStore((s) => s.history);
  const end = useScenarioStore((s) => s.end);
  const replay = useScenarioStore((s) => s.replay);
  const stage = useScenarioStore((s) => s.stage);
  const live = useScenarioStore((s) => s.liveDecision);
  const revealed = useScenarioStore((s) => s.revealed);
  const [busy, setBusy] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const elapsed = useElapsed(active?.startedAtMs ?? 0, active?.stabilisedAtMs ?? null);
  if (!active) return null;

  const meta = SCENARIOS[active.type];
  const Icon = meta.icon;
  const stable = phase === "stable";
  const faultNow = phase === "responding" && stage === "fault";
  const outcome = history[active.type]?.at(-1);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center",
        stable
          ? "border-success/35 bg-success/6"
          : faultNow
            ? "border-danger/50 bg-danger/8 shadow-glow-danger"
            : phase === "responding"
              ? "border-ai/35 bg-ai/6"
              : "border-warning/40 bg-warning/8",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <IconTile
          icon={stable ? <CircleCheck /> : phase === "awaiting-approval" ? <Hand /> : <Icon />}
          tone={stable ? "success" : faultNow ? "danger" : phase === "responding" ? "ai" : "warning"}
          size="md"
        />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg">
            {meta.title} · {active.incidentId}
            {active.origin === "rig" && <span className="ml-2 text-[13px] font-medium text-fg-muted">started by the rig: its wall adapter was unplugged</span>}
            {outcome && outcome.run > 1 && stable && <span className="font-medium text-fg-muted"> · run {outcome.run}</span>}
          </p>
          <p className="mt-0.5 text-sm text-fg-muted">
            {faultNow && "Fault detected. The grid is running without a plan right now."}
            {phase === "responding" && !faultNow &&
              (live ? `Agents are responding · step ${Math.min(revealed + 1, live.steps.length)} of ${live.steps.length}` : "Agents are responding.")}
            {phase === "awaiting-approval" && "A high-impact plan is waiting for your decision below."}
            {stable &&
              (outcome
                ? `Stable again. Recovery took ${formatNumber(outcome.recoveryMin, 1)} min in the digital twin, vs ${formatNumber(outcome.baselineMin, 0)} min with no AI.`
                : "Stable again. Every protected zone kept power.")}
          </p>
          <div className="mt-1.5 empty:hidden"><RigStatus /></div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label={sound ? "Turn sound off" : "Turn sound on"}
          aria-pressed={sound}
          title={sound ? "Sound on" : "Sound off"}
          onClick={() => {
            setSoundEnabled(!sound);
            setSound(!sound);
          }}
        >
          {sound ? <Volume2 /> : <VolumeX />}
        </Button>
        {!stable && (
          <Badge tone={faultNow ? "danger" : "warning"} icon={<Timer />} aria-label={`Elapsed ${elapsed}`}>
            <span className="font-mono tabular">{elapsed}</span>
          </Badge>
        )}
        {stable && (
          <Button size="sm" disabled={busy} onClick={() => act(replay)}>
            <RotateCcw /> Replay same scenario
          </Button>
        )}
        <Button size="sm" disabled={busy || phase === "responding"} onClick={() => act(end)}>
          End scenario
        </Button>
      </div>
    </motion.div>
  );
}
