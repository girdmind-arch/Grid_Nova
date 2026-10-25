"""The Planner's search: it invents plans, tests them in the digital twin, and keeps the best.

No plan is written in advance. For each situation the Planner gets the levers that are
physically available right now (what the Fault Responder and Zone Agents report) and searches
over them with the cross-entropy method:

    1. sample a batch of plans from a probability distribution over the levers
    2. run every plan in the digital twin and score it (cost, comfort, lost load, guardrails)
    3. move the distribution towards the best quarter of the batch, and repeat
    4. stop once a round brings no real improvement

One of the battery levers is the Planner's learned reinforcement-learning policy (gridnova.ml);
it competes in the twin against capped and idle battery strategies on equal terms.

The Critic's memory can seed the search with the plan that worked best in a similar past
situation. A good seed means the search settles in fewer rounds: fewer twin runs, a faster
response. That is how the agents get faster with experience.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np

from . import campus as c
from .simulator import Policy


@dataclass
class Lever:
    name: str
    kind: str  # float | bool | choice
    lo: float = 0.0
    hi: float = 1.0
    choices: tuple[str, ...] = ()
    label: str = ""


@dataclass
class SearchStats:
    twin_runs: int = 0
    rounds: int = 0
    rejected: int = 0  # plans the Guardrail ruled out
    seeded_from: str | None = None
    history: list[float] = field(default_factory=list)  # cost (₹) of the best safe plan after each round


def levers_for(fault, grid, learned_available: bool) -> list[Lever]:
    """What can actually be changed in this situation."""
    strategies = ("learned", "cap", "idle") if learned_available else ("cap", "idle")
    levers = [
        Lever("battery", "choice", choices=strategies, label="battery strategy"),
        Lever("cap_kw", "float", 700.0, 1700.0, label="grid import cap"),
        Lever("extra_kw", "float", 0.0, 600.0, label="extra battery support"),
        Lever("precool", "bool", label="pre-cool hostels"),
        Lever("hvac_trim", "bool", label="schedule library/admin HVAC"),
    ]
    if fault is not None and fault.type == "cloud_cover":
        levers.append(Lever("bridge", "bool", label="battery bridges the solar dip"))
    if fault is not None and fault.type == "line_failure":
        levers.append(Lever("reroute", "float", 0.0, 1.0, label="share of the building rerouted via F2"))
    if fault is not None and fault.type == "grid_outage":
        levers.append(Lever("hostel_level", "float", 0.0, 1.0, label="hostel power level"))
    return levers


def to_policy(params: dict, base: Policy, controller_factory) -> Policy:
    pol = replace(
        base,
        precool=bool(params.get("precool", base.precool)),
        hvac_trim=bool(params.get("hvac_trim", base.hvac_trim)),
        extra_discharge_kw=float(params.get("extra_kw", 0.0)),
        bridge_solar_gap=bool(params.get("bridge", False)),
        reroute_fraction=params.get("reroute", base.reroute_fraction),
        outage_hostel_level=float(params.get("hostel_level", base.outage_hostel_level)),
        controller=None,
    )
    strategy = params.get("battery", "cap")
    if strategy == "learned" and controller_factory is not None:
        pol = replace(pol, controller=controller_factory(), peak_target_kw=None, night_charge_to_pct=None, extra_discharge_kw=0.0)
    elif strategy == "cap":
        pol = replace(pol, peak_target_kw=float(params.get("cap_kw", 1300.0)))
    else:
        pol = replace(pol, peak_target_kw=None)
    return pol


class Distribution:
    """A sampling distribution over the levers: Gaussian for numbers, Bernoulli / categorical otherwise."""

    def __init__(self, levers: list[Lever], center: dict | None = None):
        self.levers = levers
        self.mean, self.std, self.p = {}, {}, {}
        for lv in levers:
            if lv.kind == "float":
                self.mean[lv.name] = (lv.lo + lv.hi) / 2
                self.std[lv.name] = (lv.hi - lv.lo) / 3
            elif lv.kind == "bool":
                self.p[lv.name] = np.array([0.5, 0.5])
            else:
                self.p[lv.name] = np.ones(len(lv.choices)) / len(lv.choices)
        if center:
            self.focus(center, tight=False)

    def focus(self, params: dict, tight: bool) -> None:
        """Centre the distribution on a known-good plan (a memory, or an analytic estimate)."""
        for lv in self.levers:
            if lv.name not in params:
                continue
            v = params[lv.name]
            if lv.kind == "float":
                self.mean[lv.name] = float(v)
                self.std[lv.name] = (lv.hi - lv.lo) / (12 if tight else 5)
            elif lv.kind == "bool":
                q = 0.85 if tight else 0.7
                self.p[lv.name] = np.array([1 - q, q]) if v else np.array([q, 1 - q])
            else:
                q = 0.8 if tight else 0.6
                probs = np.full(len(lv.choices), (1 - q) / max(1, len(lv.choices) - 1))
                probs[lv.choices.index(v)] = q
                self.p[lv.name] = probs

    def sample(self, rng: np.random.Generator) -> dict:
        out = {}
        for lv in self.levers:
            if lv.kind == "float":
                out[lv.name] = float(np.clip(rng.normal(self.mean[lv.name], self.std[lv.name]), lv.lo, lv.hi))
            elif lv.kind == "bool":
                out[lv.name] = bool(rng.random() < self.p[lv.name][1])
            else:
                out[lv.name] = lv.choices[int(rng.choice(len(lv.choices), p=self.p[lv.name]))]
        return out

    def refit(self, elites: list[dict], smoothing: float = 0.7) -> None:
        for lv in self.levers:
            vals = [e[lv.name] for e in elites]
            if lv.kind == "float":
                self.mean[lv.name] = smoothing * float(np.mean(vals)) + (1 - smoothing) * self.mean[lv.name]
                self.std[lv.name] = max((lv.hi - lv.lo) / 40, smoothing * float(np.std(vals)) + (1 - smoothing) * self.std[lv.name])
            elif lv.kind == "bool":
                q = (sum(vals) + 0.5) / (len(vals) + 1)
                self.p[lv.name] = smoothing * np.array([1 - q, q]) + (1 - smoothing) * self.p[lv.name]
            else:
                counts = np.array([vals.count(ch) for ch in lv.choices], dtype=float) + 0.3
                self.p[lv.name] = smoothing * counts / counts.sum() + (1 - smoothing) * self.p[lv.name]


def cross_entropy_search(levers, evaluate, rng, seeds: list[dict], batch: int = 16, max_rounds: int = 6,
                         elite_frac: float = 0.25, min_gain: float = 60.0, seeded_from: str | None = None,
                         min_rounds: int = 3):
    """Returns (all evaluated (params, candidate) pairs sorted best first, SearchStats).

    `evaluate(params) -> candidate` must run the plan in the twin and set candidate.score.
    `seeds` are plans to try first: the Critic's remembered plan and/or an analytic estimate.
    """
    stats = SearchStats(seeded_from=seeded_from)
    dist = Distribution(levers)
    if seeds:
        dist.focus(seeds[0], tight=seeded_from is not None)
    tried: list[tuple[dict, object]] = []
    best = float("inf")
    for rnd in range(max_rounds):
        batch_params = [dict(s) for s in seeds] if rnd == 0 else []
        # With a remembered plan, the first round only checks it and a few close variations.
        size = len(seeds) + 5 if (rnd == 0 and seeded_from) else batch
        while len(batch_params) < size:
            batch_params.append(dist.sample(rng))
        results = []
        for p in batch_params:
            cand = evaluate(p)
            stats.twin_runs += 1
            if not cand.passes:
                stats.rejected += 1
            results.append((p, cand))
        tried += results
        stats.rounds = rnd + 1
        results.sort(key=lambda r: r[1].score)
        round_best = results[0][1].score
        gain = best - round_best
        best = min(best, round_best)
        safe = [cand for _, cand in tried if cand.passes]
        if safe:
            stats.history.append(round(min(safe, key=lambda x: x.score).cost))
        if rnd + 1 >= min_rounds and gain < min_gain:
            break  # converged: another round is not worth the time
        if rnd == 0 and seeded_from:
            seed_score = results_score(results, batch_params[0])
            if round_best > seed_score - min_gain:
                break  # the remembered plan still holds: no need to explore from scratch
        n_elite = max(2, int(len(results) * elite_frac))
        dist.refit([p for p, _ in results[:n_elite]])
    tried.sort(key=lambda r: r[1].score)
    return tried, stats


def results_score(results: list[tuple[dict, object]], params: dict) -> float:
    return next(cand.score for p, cand in results if p is params or p == params)


def situation_features(fault, hour: float, soc: float, temp_c: float) -> np.ndarray:
    """How the Critic compares situations: severity, time of day, battery charge, temperature."""
    sev = fault.severity if fault is not None else 0
    return np.array([sev / 5, np.sin(2 * np.pi * hour / 24), np.cos(2 * np.pi * hour / 24), soc / 100, temp_c / 45])


def summarise_plan(params: dict, pol: Policy, fault) -> tuple[str, list[str]]:
    """A short title and the concrete actions of a plan, from its actual lever values."""
    acts: list[str] = []
    title_bits: list[str] = []
    if fault is not None and fault.type == "line_failure":
        frac = pol.reroute_fraction or 0.0
        zone = c.ZONE_BY_ID[fault.target_zone_id or "hostel-gh1"].name
        if frac > 0.02:
            acts += ["Open switch S3 to isolate F3", "Close tie switch T2-3", f"Supply {zone} from F2 at {round(frac * 100)}%"]
            title_bits.append(f"Reroute {zone} at {round(frac * 100)}%")
        else:
            acts.append(f"Keep {zone} off until F3 is repaired")
            title_bits.append(f"Wait for repair of {zone}")
    if fault is not None and fault.type == "grid_outage":
        lvl = pol.outage_hostel_level
        acts.append(f"Hostels at {round(lvl * 100)}%" if lvl > 0.02 else "Hostels off")
        title_bits.append(f"Hostels at {round(lvl * 100)}%" if lvl > 0.02 else "Hostels off")
    strategy = params.get("battery", "cap")
    if fault is not None and fault.type == "grid_outage":
        acts.append("Battery and solar carry the campus")
    elif strategy == "learned":
        acts.append("Battery run by the learned RL policy")
        title_bits.append("learned battery policy")
    elif strategy == "cap":
        acts.append(
            f"Set evening grid-import cap to {round(pol.peak_target_kw or 0):,} kW; battery discharges only if needed"
        )
        title_bits.append(f"cap import at {round(pol.peak_target_kw or 0):,} kW")
    else:
        acts.append("Battery idle")
        title_bits.append("battery idle")
    if pol.extra_discharge_kw > 20 and strategy != "learned":
        acts.append(f"Battery adds {round(pol.extra_discharge_kw):,} kW now")
    if pol.bridge_solar_gap:
        acts.append("Battery bridges the solar dip")
        title_bits.append("bridge the solar dip")
    if pol.precool:
        acts.append("Pre-cool hostels 17:30–18:00")
    if pol.hvac_trim:
        acts.append("Schedule library/admin HVAC (-5%)")
    title = title_bits[0][0].upper() + title_bits[0][1:] if title_bits else "Keep the current plan"
    if len(title_bits) > 1:
        title += ", " + title_bits[1]
    return title, acts
