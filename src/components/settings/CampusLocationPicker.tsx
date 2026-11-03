// hi
import { useEffect, useId, useState } from "react";
import { Check, Loader2, MapPin, Search } from "lucide-react";
import type { CampusLocation } from "@/types/grid";
import { USE_MOCKS, ServiceError, getLocation, searchLocations, setLocation } from "@/services";
import { useAppStore } from "@/store/appStore";
import { useScenarioStore } from "@/store/scenarioStore";
import { toast } from "@/components/ui";
import { cn } from "@/utils/cn";

const rupees = (n: number) => `₹${n.toFixed(2)}`;

/** Search any place in India and move the campus there (weather + state tariff). */
export function CampusLocationPicker() {
  const [current, setCurrent] = useState<CampusLocation | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CampusLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    if (USE_MOCKS) return;
    getLocation().then(setCurrent).catch(() => setCurrent(null));
  }, []);

  // Search as you type (debounced). An empty box shows suggested cities.
  useEffect(() => {
    if (USE_MOCKS) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      setSearching(true);
      searchLocations(query)
        .then((r) => !cancelled && setResults(r.results))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setSearching(false));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  if (USE_MOCKS) {
    return <p className="text-sm text-fg-muted">This copy runs on demo data for one campus. Open the live site to place the campus anywhere in India.</p>;
  }

  const move = async (p: CampusLocation) => {
    const key = `${p.lat},${p.lon}`;
    setMoving(key);
    try {
      const loc = await setLocation(p);
      setCurrent(loc);
      setQuery("");
      await useScenarioStore.getState().pulse();
      toast({
        title: `Campus moved to ${loc.name}`,
        description: `Live weather for ${loc.name}; ${loc.state || "state"} tariff from ${loc.discom}. Today has been re-simulated.`,
        tone: "ai",
      });
    } catch (e) {
      toast({ title: "Could not move the campus.", description: e instanceof ServiceError ? e.message : "Try again.", tone: "warning" });
    } finally {
      setMoving(null);
    }
  };

  const env = useAppStore.getState().environment;

  return (
    <div>
      {current && (
        <div className="rounded-md bg-surface-sunken p-3.5 text-sm">
          <p className="flex items-center gap-2 font-semibold text-fg">
            <MapPin aria-hidden strokeWidth={1.75} className="size-4 text-accent" />
            {current.name}
            {current.state && <span className="font-medium text-fg-muted">· {current.state}</span>}
          </p>
          <p className="mt-1 text-fg-muted">
            {current.discom}: {rupees(current.tariff.offPeak)} off-peak · {rupees(current.tariff.normal)} normal ·{" "}
            {rupees(current.tariff.peak)} peak per kWh
          </p>
          {env && env.weatherSource !== "open-meteo" && (
            <p className="mt-1 text-[13px] text-fg-subtle">Live weather unavailable right now: using a typical-day profile.</p>
          )}
        </div>
      )}

      <label htmlFor={`${listId}-q`} className="mt-4 block text-sm font-semibold text-fg">
        Move the campus
      </label>
      <div className="relative mt-1.5">
        <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
        <input
          id={`${listId}-q`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="City, town or campus in India…"
          autoComplete="off"
          aria-controls={listId}
          className="h-11 w-full rounded-md border border-border-strong bg-surface pr-9 pl-9 text-[15px] text-fg placeholder:text-fg-subtle"
        />
        {searching && <Loader2 aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-fg-subtle" />}
      </div>
      <p className="mt-1.5 text-[13px] text-fg-subtle">{query.trim().length < 2 ? "Or pick one:" : `${results.length} places found`}</p>

      <ul id={listId} className="mt-1.5 max-h-72 space-y-1 overflow-y-auto">
        {results.map((p) => {
          const key = `${p.lat},${p.lon}`;
          const here = current && Math.abs(current.lat - p.lat) < 0.01 && Math.abs(current.lon - p.lon) < 0.01;
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => void move(p)}
                disabled={!!moving || !!here}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  here ? "bg-accent/10 text-accent" : "hover:bg-surface-sunken disabled:opacity-60",
                )}
              >
                <span className="min-w-0">
                  <span className="font-semibold text-fg">{p.name}</span>
                  <span className="text-fg-muted"> · {p.state || "India"}</span>
                  <span className="block text-[13px] text-fg-subtle">
                    {p.discom} · peak {rupees(p.tariff.peak)}/kWh
                  </span>
                </span>
                {moving === key ? (
                  <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
                ) : here ? (
                  <Check aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] text-fg-subtle">Tariffs are illustrative time-of-day rates per state; check the DISCOM's latest tariff order.</p>
    </div>
  );
}
