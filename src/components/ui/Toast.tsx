// hi
import { AnimatePresence, motion } from "framer-motion";
import { CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { useToastStore, type ToastTone } from "@/store/toastStore";
import { cn } from "@/utils/cn";

// Renders toasts created with toast() from src/store/toastStore.ts.
// Mounted once in App. Announced politely to screen readers.

const toneStyles: Record<ToastTone, { icon: typeof Info; className: string }> = {
  neutral: { icon: Info, className: "text-fg-muted" },
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: CircleAlert, className: "text-danger" },
  ai: { icon: Sparkles, className: "text-ai" },
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottomnav-h)+env(safe-area-inset-bottom)+22px)] z-[60] flex flex-col items-center gap-2 px-4 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const { icon: Icon, className } = toneStyles[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 glass-strong rounded-lg border border-glass-border bg-surface-solid/92 p-4 shadow-lg"
            >
              <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", className)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-fg-muted">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-m-1.5 grid size-8 shrink-0 place-items-center rounded-sm text-fg-subtle hover:bg-surface-sunken hover:text-fg pointer-coarse:size-11"
              >
                <X className="size-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
