// hi
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge needs to know our custom shadow names so it can dedupe them.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      shadow: [{ shadow: ["sm", "md", "lg", "hero", "glow-success", "glow-danger", "glow-ai"] }],
    },
  },
});

/** Join class names and let later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
