"""Results: GridNova vs. a no-AI baseline on the same simulated campus.

Five weekdays (4-8 May) are simulated minute by minute twice: once with the
agents' policy (battery dispatch planned in the twin, pre-cooling, HVAC
scheduling) and once with no AI (battery idle, no load management). Each day
gets its own weather. Recovery times come from running each scenario three times with the
trained agents (detect + twin search + switching, see agents.py); training writes them to
ml/models/metrics.json.
"""

from __future__ import annotations

from dataclasses import replace
from functools import lru_cache

from . import campus as c
from .agents import manual_minutes
from .simulator import Conditions, Policy, best_peak_target, simulate

DAYS = [
    # label, demand factor (temperature), solar factor (clouds)
    ("Mon", 1.00, 1.00),
    ("Tue", 1.03, 0.94),
    ("Wed", 0.98, 1.02),
    ("Thu", 1.05, 0.90),
    ("Fri", 1.01, 0.98),
]
PEAK_HOURS = [17, 18, 19, 20, 21, 22]
SCENARIO_LABELS = {"cloud_cover": "Cloud cover", "heatwave": "Heatwave", "line_failure": "Line failure", "grid_outage": "Grid outage"}


START_SOC = 82.0  # each day starts with the battery charged the night before


DEFAULTS = {"batteryKwh": c.BATTERY_CAPACITY_KWH, "solarPct": 100.0, "tempOffsetC": 0.0}


def _day_cost(tot, end_soc: float = START_SOC, capacity_kwh: float = c.BATTERY_CAPACITY_KWH) -> float:
    """Energy + penalties + demand charge, plus the off-peak cost of refilling the battery to its start level."""
    refill_kwh = max(0.0, START_SOC - end_soc) / 100 * capacity_kwh / c.BATTERY_EFF
    return tot.cost_inr + tot.max_import_kw * c.DEMAND_CHARGE_INR_PER_KW_DAY + refill_kwh * c.TARIFF["off-peak"].rate


def _ai_policy(level: int) -> Policy:
    """level 1: battery only. 2: + HVAC scheduling. 3: + hostel pre-cooling (all lessons)."""
    return Policy(ai=True, night_charge_to_pct=82.0, hvac_trim=level >= 2, precool=level >= 3)


def _simulate_day(cond: Conditions, pol: Policy | None):
    if pol is None:
        return simulate(0, 24, cond, Policy.baseline(), START_SOC, dt_min=5)
    bat, _, _ = simulate(0, 17, cond, pol, START_SOC, dt_min=5)
    target = best_peak_target(17, cond, pol, bat.soc_pct)
    return simulate(0, 24, cond, replace(pol, peak_target_kw=target), START_SOC, dt_min=5)


def _hourly_max_import(steps) -> dict[int, float]:
    out: dict[int, float] = {}
    for s in steps:
        h = int(s.hour)
        out[h] = max(out.get(h, 0.0), s.grid_kw)
    return out


def build_results(battery_kwh: float = DEFAULTS["batteryKwh"], solar_pct: float = 100.0,
                  peak_rate: float | None = None, temp_offset_c: float = 0.0) -> dict:
    """Results for the given campus settings (defaults = the real campus and its state's tariff). Cached."""
    rate = c.TARIFF["peak"].rate if peak_rate is None else peak_rate
    return _build(round(battery_kwh), round(solar_pct), round(rate, 2), round(temp_offset_c, 1), c.tariff_key())


@lru_cache(maxsize=64)
def _build(battery_kwh: float, solar_pct: float, peak_rate: float, temp_offset_c: float, _tariff: tuple) -> dict:
    cost, saved_by_level = [], {1: [], 2: [], 3: []}
    peak_gm = {h: 0.0 for h in PEAK_HOURS}
    peak_base = {h: 0.0 for h in PEAK_HOURS}
    tot_gm = tot_base = 0.0
    max_gm = max_base = 0.0

    for label, dem, sol in DAYS:
        cond = Conditions(demand_factor=dem, solar_factor=sol, battery_kwh=battery_kwh,
                          solar_scale=solar_pct / 100, peak_rate=peak_rate, temp_offset_c=temp_offset_c)
        _, base_tot, base_steps = _simulate_day(cond, None)
        base_cost = _day_cost(base_tot)
        for level in (3,):  # the full policy (battery + HVAC scheduling + pre-cooling)
            bat, t, steps = _simulate_day(cond, _ai_policy(level))
            day_cost = _day_cost(t, bat.soc_pct, battery_kwh)
            saved_by_level[level].append((base_cost, day_cost))
            if level == 3:
                gm_tot, gm_steps, gm_cost = t, steps, day_cost
        cost.append({"label": label, "gridnova": round(gm_cost), "baseline": round(base_cost)})
        tot_gm += gm_cost
        tot_base += base_cost
        max_gm = max(max_gm, gm_tot.max_import_kw)
        max_base = max(max_base, base_tot.max_import_kw)
        hg, hb = _hourly_max_import(gm_steps), _hourly_max_import(base_steps)
        for h in PEAK_HOURS:
            peak_gm[h] += hg.get(h, 0.0) / len(DAYS)
            peak_base[h] += hb.get(h, 0.0) / len(DAYS)

    scen = scenario_runs()
    recovery = [{"label": SCENARIO_LABELS[s["type"]], "gridnova": s["runs"][-1]["recoveryMin"], "baseline": s["baselineMin"]} for s in scen]
    avg = lambda xs: round(sum(xs) / len(xs), 1)  # noqa: E731
    saved_all = round((1 - tot_gm / tot_base) * 100, 1)
    runs = [{"run": run, "recoveryMin": avg([s["runs"][run - 1]["recoveryMin"] for s in scen]), "costSavedPct": saved_all}
            for run in (1, 2, 3)]

    changed = {"batteryKwh": battery_kwh, "solarPct": solar_pct, "peakRate": peak_rate, "tempOffsetC": temp_offset_c}
    return {
        "dataNote": "Simulated campus calibrated on public data.",
        "settings": changed,
        "headline": {
            "costSavedPct": round((1 - tot_gm / tot_base) * 100, 1),
            "peakReducedPct": round((1 - max_gm / max_base) * 100, 1),
            "recovery": {
                "gridnovaMin": avg([r["gridnova"] for r in recovery]),
                "baselineMin": avg([r["baseline"] for r in recovery]),
            },
        },
        "cost": cost,
        "peak": [{"label": f"{h}:00", "gridnova": round(peak_gm[h]), "baseline": round(peak_base[h])} for h in PEAK_HOURS],
        "recovery": recovery,
        "runs": runs,
    }


@lru_cache(maxsize=1)
def scenario_runs() -> list[dict]:
    """Three runs of each scenario with the trained agents (from training, or measured now if missing)."""
    from .ml import runtime

    scen = runtime.METRICS.get("scenarios")
    if scen:
        return scen
    from .ml.train import scenario_learning

    return scenario_learning(runtime.MODELS)


def build_run_history() -> list[dict]:
    return [
        {"type": s["type"], "baselineMin": s["baselineMin"] or manual_minutes(s["type"], 3),
         "runs": [{"run": r["run"], "recoveryMin": r["recoveryMin"], **({"lessonApplied": r["lessonApplied"]} if r.get("lessonApplied") else {})}
                  for r in s["runs"]]}
        for s in scenario_runs()
    ]
