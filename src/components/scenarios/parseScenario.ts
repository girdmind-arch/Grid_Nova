// hi
import type { FaultType } from "@/types/grid";

// Turns a short description ("severe heatwave for an hour") into scenario
// settings. Plain keyword matching in the browser: no language model is
// called, and the UI says so.

const TYPE_WORDS: Record<FaultType, RegExp> = {
  cloud_cover: /\b(cloud|clouds|cloudy|overcast|monsoon|rain|storm|shade|shadow|dust|smog|fog|solar (?:drop|dip|loss|down))/i,
  heatwave: /\b(heat|hot|heatwave|temperature|°c|degrees|cooling|a\.?c\.?s?|air ?con|summer|loo)\b/i,
  line_failure: /\b(cable|line|feeder|wire|trip|tripped|short|spark|transformer|breaker|gh1|fault)\b/i,
  grid_outage: /\b(outage|blackout|power cut|grid (?:down|lost|loss|fail\w*|off)|no power|load ?shedding|uppcl|discom|supply (?:lost|cut))/i,
};

const SEVERITY_WORDS: [RegExp, number][] = [
  [/\b(catastrophic|extreme|massive|huge|worst|severe|terrible|record|area-wide|city-wide)\b/i, 5],
  [/\b(strong|major|big|bad|serious|heavy|long|damage\w*)\b/i, 4],
  [/\b(moderate|medium|normal)\b/i, 3],
  [/\b(light|small|short|brief)\b/i, 2],
  [/\b(mild|slight|minor|tiny|flicker|dip)\b/i, 1],
];

export interface ParsedScenario {
  type: FaultType;
  severity: number;
  durationMin: 15 | 30 | 60;
  /** Other faults the text mentioned (GridNova runs one at a time). */
  alsoMentioned: FaultType[];
}

export function parseScenario(text: string): ParsedScenario | null {
  const t = text.trim();
  if (!t) return null;

  // Earliest mention wins; the rest are reported back.
  const hits = (Object.keys(TYPE_WORDS) as FaultType[])
    .map((type) => ({ type, at: t.search(TYPE_WORDS[type]) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (!hits.length) return null;
  const [first, ...rest] = hits;

  let severity = 3;
  for (const [re, level] of SEVERITY_WORDS) {
    if (re.test(t)) {
      severity = level;
      break;
    }
  }
  const pct = t.match(/(\d{1,3})\s*%/);
  if (pct) severity = Math.max(1, Math.min(5, Math.round(Number(pct[1]) / 15)));

  let durationMin: ParsedScenario["durationMin"] = 30;
  const dur = t.match(/(\d+(?:\.\d+)?)\s*(min|mins|minutes|m\b|hours?|hrs?|h\b)/i);
  if (dur) {
    const n = Number(dur[1]) * (/^h/i.test(dur[2]) ? 60 : 1);
    durationMin = n <= 22 ? 15 : n <= 45 ? 30 : 60;
  } else if (/\b(an hour|one hour|all night|all evening|long)\b/i.test(t)) durationMin = 60;
  else if (/\b(quick|brief|few minutes)\b/i.test(t)) durationMin = 15;

  return { type: first.type, severity, durationMin, alsoMentioned: rest.map((h) => h.type) };
}

export const EXAMPLES = [
  "Severe heatwave during exam night",
  "Monsoon clouds kill solar for an hour",
  "Feeder cable to GH1 trips",
  "UPPCL blackout, 60 minutes",
];
