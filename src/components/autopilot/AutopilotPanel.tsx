import { useEffect, useRef, useState } from "react";
import type { AutopilotRequest, AutopilotStudy, PlanKey } from "@/types/autopilot";
import { ServiceError, runAutopilot } from "@/services";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { AutopilotCompare } from "./AutopilotCompare";
import { AutopilotOutcome } from "./AutopilotOutcome";
import { AutopilotSetup } from "./AutopilotSetup";
import { DEFAULT_REQUEST } from "./autopilotMeta";

type Stage = "setup" | "running" | "compare" | "approved";

/**
 * Resilience Autopilot: the "many runs" side of the Scenarios page. Describe a coming
 * heatwave + low solar + grid outage, choose what to protect, compare plans tested against
 * many versions of it, approve one, and see it against the no-AI baseline. Simulation only.
 */
export function AutopilotPanel() {
  const [req, setReq] = useState<AutopilotRequest>(DEFAULT_REQUEST);
  const [stage, setStage] = useState<Stage>("setup");
  const [study, setStudy] = useState<AutopilotStudy | null>(null);
  const [chosen, setChosen] = useState<PlanKey>("balanced");
  const [error, setError] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stage === "setup") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    top.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [stage]);

  const run = async () => {
    setStage("running");
    setError(null);
    try {
      const s = await runAutopilot(req);
      setStudy(s);
      // Start on the balanced plan if the Guardrail allows it, else the first one it does.
      const ok = (["balanced", "safest", "cheapest"] as PlanKey[]).find((k) => s.recommended[k].passes);
      setChosen(ok ?? "balanced");
      setStage("compare");
    } catch (e) {
      setError(e instanceof ServiceError ? e.message : "The study could not be run. Try again.");
      setStage("setup");
    }
  };

  return (
    <div ref={top} className="scroll-mt-24 space-y-4">
      {(stage === "setup" || stage === "running") && <AutopilotSetup value={req} onChange={setReq} onRun={() => void run()} busy={stage === "running"} />}
      {error && <ErrorState message={error} onRetry={() => void run()} />}
      {stage === "running" && (
        <Card>
          <p className="text-sm font-semibold text-fg">Running {req.runs} versions of the emergency through the digital twin…</p>
          <Skeleton className="mt-3 h-[280px]" />
        </Card>
      )}
      {stage === "compare" && study && (
        <AutopilotCompare study={study} chosen={chosen} onChoose={setChosen} onApprove={() => setStage("approved")} onBack={() => setStage("setup")} />
      )}
      {stage === "approved" && study && (
        <AutopilotOutcome study={study} k={chosen} onBack={() => setStage("compare")} onRestart={() => setStage("setup")} />
      )}
    </div>
  );
}
