// hi
import { useId, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { ControlMode } from "@/types/grid";
import { setControlMode } from "@/services";
import { VIEW_ONLY_MESSAGE, canActNow } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { Button, Card, MODE_INFO, Modal, toast } from "@/components/ui";
import { cn } from "@/utils/cn";

const ORDER: ControlMode[] = ["ai", "fallback", "manual"];

const HEADLINE: Record<ControlMode, string> = {
  ai: "GridNova agents are in control.",
  fallback: "Safe fallback rules are in control.",
  manual: "You are in manual control.",
};

/** What each mode means for the operator, in one line. */
const DETAIL: Record<ControlMode, string> = {
  ai: "Agents forecast, plan, test in the digital twin and act. Big moves still ask you first.",
  fallback: "Fixed safety rules keep the grid stable. Agents keep forecasting but do not act.",
  manual: "You switch loads and sources yourself. Agents only advise. Guardrails still apply.",
};

/** Settings hero: who is in control, and a way to change it. Manual asks for confirmation. */
export function ControlModeHero() {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [pending, setPending] = useState<ControlMode | null>(null);
  const [confirmManual, setConfirmManual] = useState(false);
  const name = useId();

  const apply = async (next: ControlMode) => {
    if (!canActNow()) return void toast({ ...VIEW_ONLY_MESSAGE });
    setConfirmManual(false);
    setPending(next);
    try {
      const ack = await setControlMode(next);
      setMode(ack.mode);
      toast({ title: `${MODE_INFO[ack.mode].label} is on`, description: ack.message, tone: ack.mode === "ai" ? "ai" : "warning" });
    } catch {
      toast({ title: "The mode could not be changed.", description: "Nothing was switched. Try again.", tone: "warning" });
    } finally {
      setPending(null);
    }
  };

  const choose = (next: ControlMode) => {
    if (next === mode || pending) return;
    if (next === "manual") setConfirmManual(true);
    else void apply(next);
  };

  return (
    <Card variant="hero" padding="lg">
      <p className="text-sm font-semibold text-hero-text-muted">Operating mode</p>
      <h2 className="mt-1 max-w-2xl text-[26px] leading-tight font-bold tracking-tight sm:text-[30px]">{HEADLINE[mode]}</h2>
      <p className="mt-2 max-w-xl text-[15px] text-hero-text-muted">{DETAIL[mode]}</p>

      <div role="radiogroup" aria-label="Operating mode" className="mt-6 grid gap-3 md:grid-cols-3">
        {ORDER.map((m) => {
          const info = MODE_INFO[m];
          const Icon = info.icon;
          const checked = m === mode;
          return (
            <label
              key={m}
              className={cn(
                "relative flex cursor-pointer gap-3 rounded-md border p-4 transition-colors duration-150",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white",
                checked ? "border-white bg-white text-[var(--hero-from)]" : "border-white/30 bg-white/10 hover:bg-white/16",
                pending && "cursor-wait",
              )}
            >
              <input
                type="radio"
                name={name}
                value={m}
                checked={checked}
                onChange={() => choose(m)}
                disabled={!!pending}
                className="sr-only"
              />
              <Icon aria-hidden strokeWidth={1.75} className="mt-0.5 size-5 shrink-0" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[15px] font-semibold">
                  {info.label}
                  {checked && <Check aria-hidden strokeWidth={1.75} className="size-4" />}
                  {pending === m && <Loader2 aria-hidden strokeWidth={1.75} className="size-4 animate-spin" />}
                </span>
                <span className={cn("mt-0.5 block text-sm", checked ? "text-[var(--hero-to)]" : "text-hero-text-muted")}>
                  {info.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only">
        {pending ? `Switching to ${MODE_INFO[pending].label}` : ""}
      </p>

      <Modal
        open={confirmManual}
        onOpenChange={setConfirmManual}
        title="Take manual control?"
        description="The agents stop acting and only advise. You will switch loads and sources yourself."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmManual(false)}>
              Keep {MODE_INFO[mode].label}
            </Button>
            <Button variant="primary" onClick={() => void apply("manual")}>
              Switch to Manual
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm text-fg-muted">
          <li>Guardrails still block unsafe commands, like dropping lab power.</li>
          <li>The evening peak starts at 18:00. Without the agents, the battery plan will not run on its own.</li>
          <li>You can switch back to AI Control here at any time.</li>
        </ul>
      </Modal>
    </Card>
  );
}
