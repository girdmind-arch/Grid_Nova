// hi
import { useState } from "react";
import { BatteryFull, CloudLightning, IndianRupee, Loader2, Scale, Send, Thermometer } from "lucide-react";
import { setGoal as setGoalService } from "@/services";
import { DEFAULT_GOAL, useAppStore } from "@/store/appStore";
import { Button, IconTile, toast } from "@/components/ui";
import { cn } from "@/utils/cn";

const PRESETS = [
  { id: "balanced", title: "Balanced", goal: DEFAULT_GOAL, detail: "The everyday default: labs first, then cost.", icon: Scale },
  { id: "cost", title: "Lowest cost", goal: "Keep tonight's bill as low as possible.", detail: "More battery in the 18:00–22:00 peak, more load shifting.", icon: IndianRupee },
  { id: "comfort", title: "Hostel comfort", goal: "Keep hostels cool and comfortable tonight.", detail: "Pre-cools early and avoids trimming hostel AC.", icon: Thermometer },
  { id: "battery", title: "Battery health", goal: "Protect battery health; avoid deep discharge.", detail: "Keeps charge between 40% and 80%. Costs a little more.", icon: BatteryFull },
  { id: "storm", title: "Storm ready", goal: "Prepare for a storm: keep reserve power for outages.", detail: "Holds the battery near full in case the main grid drops.", icon: CloudLightning },
];

/** One-tap goals for the Orchestrator. Sends the goal, then shows how it was understood. */
export function GoalPresets() {
  const goal = useAppStore((s) => s.goal);
  const interpretation = useAppStore((s) => s.goalInterpretation);
  const saveGoal = useAppStore((s) => s.setGoal);
  const [sending, setSending] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const pick = async (id: string, text: string) => {
    if (text === goal || sending) return;
    setSending(id);
    try {
      const ack = await setGoalService(text);
      saveGoal(ack.goal, ack.interpretation);
      toast({ title: "Goal updated", description: "The Orchestrator will plan around it from the next cycle.", tone: "ai" });
    } catch {
      toast({ title: "The goal could not be sent.", description: "Safe rule-based control is active. Try again.", tone: "warning" });
    } finally {
      setSending(null);
    }
  };

  const custom = !PRESETS.some((p) => p.goal === goal);

  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PRESETS.map((p) => {
          const active = p.goal === goal;
          const Icon = p.icon;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => void pick(p.id, p.goal)}
                disabled={!!sending}
                className={cn(
                  "flex h-full w-full items-start gap-3 rounded-md border p-4 text-left transition-colors duration-150 disabled:cursor-wait",
                  active ? "border-ai/50 bg-ai/8" : "border-border bg-surface hover:border-border-strong hover:bg-surface-sunken",
                )}
              >
                <IconTile icon={<Icon />} tone={active ? "ai" : "neutral"} size="sm" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-semibold text-fg">
                    {p.title}
                    {active && <span className="rounded-full bg-ai/12 px-2 py-0.5 text-xs font-semibold text-ai">Current</span>}
                    {sending === p.id && <Loader2 aria-hidden strokeWidth={1.75} className="size-4 animate-spin text-ai" />}
                  </span>
                  <span className="mt-0.5 block text-sm text-fg-muted">{p.detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Or say it in your own words. */}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (text) void pick("custom", text).then(() => setDraft(""));
        }}
      >
        <label htmlFor="goal-input" className="sr-only">
          Your own goal
        </label>
        <input
          id="goal-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Or type your own goal…"
          className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-[15px] text-fg placeholder:text-fg-subtle"
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Send goal" disabled={!draft.trim() || !!sending} className="size-11">
          {sending === "custom" ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </form>

      <div aria-live="polite" className="mt-4 rounded-md bg-surface-sunken px-4 py-3 text-sm">
        <p className="text-fg">
          <span className="font-semibold">{custom ? "Your own goal: " : "Current goal: "}</span>
          {goal}
        </p>
        {interpretation && (
          <p className="mt-1 text-fg-muted">
            <span className="font-semibold text-ai">Orchestrator: </span>
            {interpretation}
          </p>
        )}
      </div>
    </div>
  );
}
