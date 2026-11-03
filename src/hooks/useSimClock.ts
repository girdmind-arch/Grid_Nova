// hi
import { useEffect, useState } from "react";
import { simNow } from "@/utils/simTime";

/** Current simulated time, re-rendering every `tickMs`. Starts at 17:20 IST. */
export function useSimClock(tickMs = 1000) {
  const [now, setNow] = useState(simNow);

  useEffect(() => {
    const id = window.setInterval(() => setNow(simNow()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  return now;
}
