// hi
import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/**
 * Animates a number from its previous value to `target` (count-up effect).
 * Jumps straight to the value when the user prefers reduced motion.
 */
export function useCountUp(target: number, duration = 0.8) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? target : 0);
  const from = useRef(reduce ? target : 0);

  useEffect(() => {
    if (reduce) {
      setValue(target);
      from.current = target;
      return;
    }
    const controls = animate(from.current, target, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: setValue,
    });
    from.current = target;
    return () => controls.stop();
  }, [target, duration, reduce]);

  return value;
}
