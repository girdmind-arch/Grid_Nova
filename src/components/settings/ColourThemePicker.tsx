// hi
import { useRef, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { PALETTES, usePalette } from "@/hooks/usePalette";
import { cn } from "@/utils/cn";

/**
 * Colour theme cards: a glass swatch of each theme's hero with its accent dot.
 * Works as a radio group (arrow keys move and select).
 */
export function ColourThemePicker() {
  const { palette, setPalette } = usePalette();
  const { theme } = useTheme();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + PALETTES.length) % PALETTES.length;
    setPalette(PALETTES[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {PALETTES.map((p, i) => {
        const [from, to, accent] = theme === "dark" ? p.dark : p.light;
        const selected = palette === p.id;
        return (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setPalette(p.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "glass group rounded-lg border bg-surface-raised p-2.5 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
              selected ? "border-accent shadow-md ring-2 ring-accent/25" : "border-glass-border",
            )}
          >
            <span
              aria-hidden
              className="relative block h-12 overflow-hidden rounded-md border border-white/10"
              style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }}
            >
              <span className="absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.22),transparent_45%)]" />
              <span
                className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 rounded-full border-2 border-white/80 shadow-sm"
                style={{ backgroundColor: accent }}
              />
            </span>
            <span className="mt-2 flex items-center justify-between px-0.5 text-sm font-semibold text-fg">
              {p.name}
              {selected && <Check aria-hidden className="size-4 text-accent" strokeWidth={2.25} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
