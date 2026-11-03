// hi
import { AnimatePresence, motion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { MODE_INFO } from "@/components/ui/ModeIndicator";
import type { ControlMode } from "@/types/grid";

interface SituationHeroProps {
  headline: string;
  detail: string;
  mode: ControlMode;
  onOpenGrid: () => void;
}

/** The one gradient element on the Control Room: the situation in plain English. */
export function SituationHero({ headline, detail, mode, onOpenGrid }: SituationHeroProps) {
  return (
    <Card variant="hero" padding="lg" className="flex flex-col justify-between gap-6">
      <div>
        <Badge tone="onHero" size="sm" dot pulse={mode === "ai"}>
          Right now · {MODE_INFO[mode].label}
        </Badge>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={headline}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="mt-4 max-w-2xl text-[26px] leading-tight font-bold tracking-tight text-balance sm:text-[30px]">{headline}</h2>
            {detail && <p className="mt-2.5 max-w-xl text-[15px] text-hero-text-muted">{detail}</p>}
          </motion.div>
        </AnimatePresence>
      </div>
      <div>
        <Button variant="onHero" size="lg" onClick={onOpenGrid}>
          <Maximize2 /> Open live grid
        </Button>
      </div>
    </Card>
  );
}
