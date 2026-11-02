"""Resilience Autopilot: plan for a grid outage before it happens, and prove the plan in the twin.

The single-scenario flow (agents.py) answers "what do we do now?" for one version of a fault.
The Autopilot asks the harder question an operator faces when a heatwave warning comes in:
"the grid might fail this evening, solar will be weak, and we don't know exactly when or for how
long. What should we protect, what should we shed, and will the battery last?"

It works in four steps:

  1. Sample many versions of the same emergency (demand, solar output, outage start and length,
     battery charge at the warning), from the operator's scenario.
  2. Run every candidate plan, and a no-AI baseline, through every version in a vectorised
     digital twin of the campus (same buildings, loads, solar and battery limits as simulator.py).
  3. Score each plan on what an operator cares about: critical-load uptime, time to restore
     everything after the grid returns, energy cost, battery reserve left, and how evenly the
     cuts were shared between the buildings that were not protected.
  4. The Guardrail checks each plan; three safe plans are recommended (cheapest, safest,
     balanced) for the operator to approve.

Everything here is a simulation. Nothing is sent to the live grid or to the tabletop rig.
"""

from __future__ import annotations

import itertools
import math
import time
import uuid
from dataclasses import dataclass

import numpy as np

from . import campus as c
from .simulator import REQUEST_POLICY, Conditions, zone_loads

DT_MIN = 5.0
DT_H = DT_MIN / 60
LEAD_H = 2.0  # the warning arrives this long before the forecast outage
TAIL_H = 1.0  # keep simulating this long after the latest possible grid return
CHARGE_KW = 400.0  # pre-charging rate (same as the simulator's charging limit)
OK = 0.995  # a building counts as "at full power" when it gets 99.5% of what it asks for

# Restoration after the grid returns (modelled switching times, minutes):
# GridNova recloses breakers in stages (30 s per building it had cut); a manual crew takes longer.
AUTO_DETECT_MIN = 0.4
AUTO_PER_BUILDING_MIN = 0.5
MANUAL_RESTORE_MIN = 14.0

# Pre-cooling: hostels run 4% harder in the hour before the outage, then need ~8% less for 2 hours.
PRECOOL_BOOST, PRECOOL_RELIEF, PRECOOL_RELIEF_H = 1.04, 0.92, 2.0

ZONES = c.ZONES
ZONE_IDS = [z.id for z in ZONES]
KINDS = [z.kind for z in ZONES]
IS_HOSTEL = np.array([k == "hostel" for k in KINDS])
LOW_PRIORITY = np.array([k in ("hostel", "residence") for k in KINDS])  # what a manual crew sheds first
CRITICAL_IDS = tuple(z.id for z in ZONES if z.priority == "critical")
FAIR_GAP = 0.25  # guardrail: no unprotected building is cut more than 25 points deeper than another


# ---------------------------------------------------------------- inputs
@dataclass(frozen=True)
class Scenario:
    heat_severity: int = 4
    solar_pct: float = 35.0
    outage_start: float = 14.5
    outage_hours: float = 2.0
    start_soc: float = 70.0
    runs: int = 40
    floor_pct: float = c.BATTERY_FLOOR_PCT
    protect: tuple[str, ...] = CRITICAL_IDS
    seed: int = 7

    def normalised(self) -> "Scenario":
        protect = tuple(dict.fromkeys([*CRITICAL_IDS, *(p for p in self.protect if p in c.ZONE_BY_ID)]))
        return Scenario(
            heat_severity=int(min(5, max(0, self.heat_severity))),
            solar_pct=float(min(100, max(0, self.solar_pct))),
            outage_start=float(min(22, max(6, self.outage_start))),
            outage_hours=float(min(6, max(0.5, self.outage_hours))),
            start_soc=float(min(c.BATTERY_CEIL_PCT, max(self.floor_pct + 5, self.start_soc))),
            runs=int(min(60, max(10, self.runs))),
            floor_pct=float(min(60, max(c.BATTERY_FLOOR_PCT, self.floor_pct))),
            protect=protect,
            seed=int(self.seed),
        )


@dataclass(frozen=True)
class Variants:
    """The sampled versions of the emergency, one entry per run."""

    demand: np.ndarray  # demand factor
    solar: np.ndarray  # share of clear-sky solar actually produced
    start: np.ndarray  # outage start (hour)
    end: np.ndarray  # grid return (hour)
    soc0: np.ndarray  # battery % when the warning arrives


def sample_variants(sc: Scenario) -> Variants:
    rng = np.random.default_rng(sc.seed)
    n = sc.runs
    demand = np.clip(rng.normal(1.0, 0.05, n), 0.88, 1.15)
    solar = np.clip(sc.solar_pct / 100 * rng.uniform(0.6, 1.3, n), 0.0, 1.0)
    start = sc.outage_start + rng.uniform(-0.5, 0.5, n)
    end = start + sc.outage_hours * rng.uniform(0.75, 1.35, n)
    soc0 = np.clip(sc.start_soc + rng.uniform(-4, 4, n), sc.floor_pct + 1, c.BATTERY_CEIL_PCT)
    return Variants(demand, solar, start, end, soc0)


@dataclass(frozen=True)
class Plan:
    id: str
    style: str  # fair | ladder | baseline
    levels: tuple[float, ...]  # power level per building during the outage (protected ones stay at 1)
    precharge: float | None = None  # charge the battery to this % before the outage
    precool: bool = False
    # Energy budget: keep `guard` x what the protected buildings need until the planned grid return,
    # and share what is left evenly over that time among the other buildings (re-planned every step).
    guard: float | None = None
    guard_late: bool = True  # plan the guard to the late grid return (True) or the forecast one (False)
    ai: bool = True


def _levels_fair(level: float) -> tuple[float, ...]:
    return tuple(level for _ in ZONES)


def _levels_ladder(low: float, other: float) -> tuple[float, ...]:
    return tuple(low if lp else other for lp in LOW_PRIORITY)


def candidate_plans(sc: Scenario) -> list[Plan]:
    """Every plan the Autopilot tests: preparation x how cuts are shared x an emergency cut-off."""
    shares: list[tuple[str, tuple[float, ...], str]] = []
    for lv in (1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0):
        shares.append(("fair", _levels_fair(lv), f"f{round(lv * 100)}"))
    for low, other in ((0.0, 1.0), (0.0, 0.6), (0.3, 1.0), (0.5, 0.8)):
        shares.append(("ladder", _levels_ladder(low, other), f"l{round(low * 100)}-{round(other * 100)}"))
    plans = []
    guards = ((None, True), (1.0, False), (1.0, True), (1.15, True))
    for pre, cool, (style, levels, tag), (g, late) in itertools.product((None, 80.0, 90.0), (False, True), shares, guards):
        if pre is not None and pre <= sc.start_soc:
            continue  # nothing to pre-charge
        pid = f"{tag}-p{int(pre or 0)}-{'c' if cool else 'n'}-g{int((g or 0) * 100)}{'l' if late else 'f'}"
        plans.append(Plan(pid, style, levels, pre, cool, g, late))
    return plans


BASELINE = Plan("baseline", "baseline", tuple(0.0 if h else 1.0 for h in IS_HOSTEL), ai=False)


def latest_return(sc: Scenario) -> float:
    """The latest grid return the plan prepares for: the forecast's late start and long outage."""
    return sc.outage_start + 0.5 + sc.outage_hours * 1.35


# ---------------------------------------------------------------- the vectorised twin
@dataclass
class Twin:
    sc: Scenario
    var: Variants
    times: np.ndarray  # (K,) hours
    base: np.ndarray  # (K, Z) kW each building asks for (heatwave included, demand factor 1)
    clear: np.ndarray  # (K,) clear-sky solar kW
    rate: np.ndarray  # (K,) ₹/kWh
    protect: np.ndarray  # (Z,) bool

    @staticmethod
    def build(sc: Scenario, var: Variants) -> "Twin":
        t0 = sc.outage_start - LEAD_H
        t_end = float(var.end.max()) + TAIL_H
        k = int(math.ceil((t_end - t0) / DT_H))
        times = t0 + np.arange(k) * DT_H
        cond = Conditions(heat_severity=sc.heat_severity)
        base = np.array([[z.kw for z in zone_loads(t, cond, REQUEST_POLICY)] for t in times])
        clear = np.array([cond.solar_and_temp(t)[0] for t in times])
        rate = np.array([c.tariff_at(t).rate for t in times])
        protect = np.array([zid in sc.protect for zid in ZONE_IDS])
        return Twin(sc, var, times, base, clear, rate, protect)


@dataclass
class RunResult:
    """Per-run outcomes of one plan (arrays of length R)."""

    plan: Plan
    interruption_min: np.ndarray
    uptime_pct: np.ndarray
    restore_min: np.ndarray
    cost: np.ndarray
    reserve: np.ndarray
    min_soc: np.ndarray
    over_contract: np.ndarray  # kW the plan's pre-charging adds above the contract limit
    fairness: np.ndarray
    served_pct: np.ndarray  # unprotected buildings, share of energy asked for during the outage
    unserved_kwh: np.ndarray
    zone_served: np.ndarray  # (R, Z) share served during the outage
    max_import: np.ndarray
    trace: dict | None = None


def run_plan(tw: Twin, plan: Plan, record: bool = False) -> RunResult:
    return run_batch(tw, [plan], record)[0]


def run_batch(tw: Twin, plans: list[Plan], record: bool = False) -> list[RunResult]:
    """Runs every plan through every version of the emergency at once: one row per (plan, run)."""
    sc, var = tw.sc, tw.var
    P, R, Z = len(plans), len(var.demand), len(ZONES)
    N = P * R
    cap, eff, floor = c.BATTERY_CAPACITY_KWH, c.BATTERY_EFF, sc.floor_pct
    rep = lambda a: np.repeat(np.asarray(a, dtype=float), R)  # noqa: E731  per-plan value -> per-row
    tile = lambda a: np.tile(a, P)  # noqa: E731  per-run value -> per-row

    ai = np.repeat(np.array([p.ai for p in plans]), R)
    levels = np.repeat(np.array([p.levels for p in plans], dtype=float), R, axis=0)  # (N, Z)
    protect = tw.protect[None, :]
    prot = ai[:, None] & protect  # (N, Z): buildings the plan keeps whole
    levels = np.where(prot, 1.0, levels)
    precharge = rep([p.precharge if (p.ai and p.precharge is not None) else np.nan for p in plans])
    precool = rep([p.ai and p.precool for p in plans]).astype(bool)
    guard = rep([p.guard if (p.ai and p.guard is not None) else np.nan for p in plans])
    has_guard = ~np.isnan(guard)
    guard_until = rep([latest_return(sc) if p.guard_late else sc.outage_start + sc.outage_hours for p in plans])

    demand, solar_f, start, end = tile(var.demand), tile(var.solar), tile(var.start), tile(var.end)
    soc = tile(var.soc0).astype(float)
    cost = np.zeros(N)
    max_import = np.zeros(N)
    over = np.zeros(N)
    min_soc = soc.copy()
    req_out = np.zeros((N, Z))
    served_out = np.zeros((N, Z))
    out_steps = np.zeros(N)
    ok_steps = np.zeros(N)
    last_prot_ok = np.ones(N, dtype=bool)
    last_cut = np.zeros(N)
    reserve = np.full(N, np.nan)
    crit = tw.protect  # uptime is always judged on the buildings the operator chose to protect
    tr = {k: [] for k in ("soc", "req", "served", "solar", "ok", "out")} if record else None

    for k, t in enumerate(tw.times):
        pre = t < start
        out = (t >= start) & (t < end)
        post = t >= end
        req = tw.base[k][None, :] * demand[:, None]
        if precool.any():
            before = pre & (t >= start - 1.0)
            during = out & (t < start + PRECOOL_RELIEF_H)
            factor = np.where(precool & before, PRECOOL_BOOST, np.where(precool & during, PRECOOL_RELIEF, 1.0))
            req = req * np.where(IS_HOSTEL[None, :], factor[:, None], 1.0)
        solar = tw.clear[k] * solar_f

        # The moment the grid comes back: what is left in the battery.
        reserve = np.where(post & np.isnan(reserve), soc, reserve)

        # ---- grid available (before the outage, and after it) ----
        net = req.sum(1) - solar
        room = np.maximum(0.0, (np.nan_to_num(precharge, nan=0.0) - soc) / 100 * cap / eff / DT_H)
        charge = np.where(pre & ~np.isnan(precharge), np.minimum(np.minimum(CHARGE_KW, room), np.maximum(0.0, c.CONTRACT_LIMIT_KW - net)), 0.0)
        grid_kw = np.where(pre | post, np.maximum(net, 0.0) + charge, 0.0)
        cost += grid_kw * DT_H * tw.rate[k]
        max_import = np.maximum(max_import, grid_kw)
        over = np.maximum(over, np.where(pre, grid_kw - np.maximum(net, c.CONTRACT_LIMIT_KW), 0.0))
        soc = soc + charge * DT_H * eff / cap * 100

        # ---- islanded: battery and solar only ----
        lv = levels
        if has_guard.any():
            # Energy budget: set aside what the protected buildings need until the planned grid return
            # (with the margin), and spread whatever is left evenly over that time for everyone else.
            hours_left = np.maximum(guard_until - t, DT_H)
            usable = np.maximum(0.0, (soc - floor) / 100 * cap * eff)
            p_kw = (req * prot).sum(1)
            np_kw = (req * ~prot).sum(1)
            spare = usable - np.nan_to_num(guard, nan=0.0) * np.maximum(p_kw - solar, 0.0) * hours_left
            budget = np.divide(np.maximum(spare, 0.0) / hours_left + np.maximum(solar - p_kw, 0.0), np_kw, out=np.ones(N), where=np_kw > 0)
            cap_lv = np.where(has_guard, np.clip(budget, 0.0, 1.0), 1.0)
            lv = np.where(prot, lv, np.minimum(lv, cap_lv[:, None]))
        want = req * lv
        need = want.sum(1) - solar
        max_out = np.minimum(c.BATTERY_MAX_KW, np.maximum(0.0, (soc - floor) / 100 * cap * eff / DT_H))
        batt = np.clip(need, 0.0, max_out)
        short = np.maximum(need - batt, 0.0)
        room_kw = np.maximum(0.0, (c.BATTERY_CEIL_PCT - soc) / 100 * cap / eff / DT_H)
        solar_charge = np.minimum(np.minimum(np.maximum(-need, 0.0), CHARGE_KW), room_kw)

        # Shortfall. GridNova: unprotected buildings give way first (in proportion), protected ones last.
        # No AI: whatever is switched on browns out together (prot is all False for those rows).
        np_want = (want * ~prot).sum(1)
        p_want = (want * prot).sum(1)
        cut_np = np.minimum(short, np_want)
        cut_p = np.minimum(short - cut_np, p_want)
        f_np = np.divide(cut_np, np_want, out=np.zeros(N), where=np_want > 0)
        f_p = np.divide(cut_p, p_want, out=np.zeros(N), where=p_want > 0)
        served = want * (1 - np.where(prot, f_p[:, None], f_np[:, None]))

        soc = soc - np.where(out, batt * DT_H / eff / cap * 100, 0.0) + np.where(out, solar_charge * DT_H * eff / cap * 100, 0.0)
        min_soc = np.minimum(min_soc, soc)
        req_out += out[:, None] * req * DT_H
        served_out += out[:, None] * served * DT_H
        prot_ok = np.all(served[:, crit] >= req[:, crit] * OK, axis=1) if crit.any() else np.ones(N, dtype=bool)
        cut = (served < req * OK).sum(1)
        out_steps += out
        ok_steps += out & prot_ok
        last_prot_ok = np.where(out, prot_ok, last_prot_ok)
        last_cut = np.where(out, cut, last_cut)
        if tr is not None:
            tr["soc"].append(soc.copy())
            tr["req"].append(req.sum(1))
            tr["served"].append(np.where(out, served.sum(1), req.sum(1)))
            tr["solar"].append(solar.copy())
            tr["ok"].append(np.where(out, prot_ok, True))
            tr["out"].append(out.copy())

    reserve = np.where(np.isnan(reserve), soc, reserve)
    restore = np.where(
        ai,
        AUTO_DETECT_MIN * (0.7 + 0.1 * sc.heat_severity) + AUTO_PER_BUILDING_MIN * last_cut,
        round(MANUAL_RESTORE_MIN * (0.7 + 0.1 * sc.heat_severity), 1),
    )
    out_min = out_steps * DT_MIN
    interruption = (out_steps - ok_steps) * DT_MIN + np.where(last_prot_ok, 0.0, restore)
    uptime = 100 * (1 - interruption / np.maximum(out_min + restore, 1e-9))

    unprot = ~tw.protect
    share = np.divide(served_out, req_out, out=np.ones((N, Z)), where=req_out > 1e-9)
    if unprot.any():
        f = share[:, unprot]
        s2 = (f**2).sum(1)
        fairness = np.where(s2 > 1e-12, f.sum(1) ** 2 / (unprot.sum() * np.maximum(s2, 1e-12)), 1.0)
        served_pct = 100 * served_out[:, unprot].sum(1) / np.maximum(req_out[:, unprot].sum(1), 1e-9)
    else:
        fairness = np.ones(N)
        served_pct = np.full(N, 100.0)
    unserved = (req_out - served_out).sum(1)
    trace = {k: np.array(v) for k, v in tr.items()} if tr is not None else None

    results = []
    for i, plan in enumerate(plans):
        sl = slice(i * R, (i + 1) * R)
        tri = {k: v[:, sl] for k, v in trace.items()} if trace is not None else None
        results.append(
            RunResult(plan, interruption[sl], uptime[sl], restore[sl], cost[sl], reserve[sl], min_soc[sl], over[sl],
                      fairness[sl], served_pct[sl], unserved[sl], share[sl], max_import[sl], tri)
        )
    return results


# ---------------------------------------------------------------- scoring
def p10(a: np.ndarray) -> float:
    return float(np.percentile(a, 10))


def guardrail(r: RunResult, sc: Scenario) -> list[dict]:
    R = len(r.cost)
    protected_runs = int((r.interruption_min <= 1e-6).sum())
    need = math.ceil(0.95 * R)
    names = ", ".join(c.ZONE_BY_ID[z].name for z in sc.protect)
    unprot = [i for i, zid in enumerate(ZONE_IDS) if zid not in sc.protect]
    mean_share = r.zone_served.mean(0)
    gap = float(mean_share[unprot].max() - mean_share[unprot].min()) if unprot else 0.0
    added = float(r.over_contract.max())
    res = p10(r.reserve)
    ceiling_ok = r.plan.precharge is None or r.plan.precharge <= c.BATTERY_CEIL_PCT
    return [
        {
            "id": "G1",
            "ok": protected_runs >= need,
            "text": f"{names} stay at full power in {protected_runs} of {R} runs"
            + ("." if protected_runs >= need else f" (needs {need})."),
        },
        {
            "id": "G2",
            "ok": bool(res >= sc.floor_pct - 0.5 and ceiling_ok),
            "text": f"Battery stays between {round(sc.floor_pct)}% and 90%; worst-case reserve when the grid returns: {round(res)}%.",
        },
        {
            "id": "G4",
            "ok": added <= 1e-6,
            "text": "Pre-charging never pushes grid import over the 1,600 kW contract limit."
            if added <= 1e-6
            else f"Pre-charging would push grid import {round(added):,} kW over the contract limit.",
        },
        {
            "id": "G6",
            "ok": gap <= FAIR_GAP + 1e-6,
            "text": "Cuts are shared evenly: no unprotected building loses more than 25 points more than another."
            if gap <= FAIR_GAP + 1e-6
            else f"Unfair: one unprotected building would get {round(gap * 100)} points less power than another.",
        },
    ]


def metrics(r: RunResult) -> dict:
    return {
        "criticalUptimePct": round(float(r.uptime_pct.mean()), 1),
        "criticalUptimeP10": round(p10(r.uptime_pct), 1),
        "protectedRuns": int((r.interruption_min <= 1e-6).sum()),
        "interruptionMin": round(float(r.interruption_min.mean()), 1),
        "recoveryMin": round(float(r.restore_min.mean()), 1),
        "costInr": round(float(r.cost.mean())),
        "reserveP10Pct": round(p10(r.reserve), 1),
        "reserveMeanPct": round(float(r.reserve.mean()), 1),
        "fairness": round(float(r.fairness.mean()) * 100),
        "servedPct": round(float(r.served_pct.mean()), 1),
        "unservedKwh": round(float(r.unserved_kwh.mean())),
    }


def _hhmm(hour: float) -> str:
    m = int(round(hour * 60)) % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def describe(plan: Plan, sc: Scenario) -> tuple[str, list[str]]:
    if not plan.ai:
        return "No-AI baseline", [
            "No preparation before the outage",
            "Hostels switched off, every other building left on",
            "When the battery runs out, everything still on browns out together",
            f"Manual crew restores power after the grid returns (~{round(MANUAL_RESTORE_MIN * (0.7 + 0.1 * sc.heat_severity))} min)",
        ]
    acts, bits = [], []
    if plan.precharge:
        acts.append(f"Pre-charge the battery to {round(plan.precharge)}% before {_hhmm(sc.outage_start)} while the grid is up")
        bits.append(f"pre-charge {round(plan.precharge)}%")
    if plan.precool:
        acts.append(f"Pre-cool hostels {_hhmm(sc.outage_start - 1)}–{_hhmm(sc.outage_start)}")
        bits.append("pre-cool")
    names = [c.ZONE_BY_ID[z].name for z in sc.protect]
    acts.append(f"Keep {', '.join(names)} at full power")
    lv = [l for l, zid in zip(plan.levels, ZONE_IDS) if zid not in sc.protect]
    if plan.style == "fair":
        level = round((lv[0] if lv else 1.0) * 100)
        acts.append(f"Run every other building at {level}% during the outage" if level else "Switch off every other building during the outage")
        bits.append(f"others at {level}%")
    else:
        low = round(plan.levels[int(np.argmax(LOW_PRIORITY))] * 100)
        other = round(plan.levels[int(np.argmin(LOW_PRIORITY))] * 100)
        acts.append(f"Hostels and faculty housing at {low}%, academic buildings at {other}%")
        bits.append(f"hostels {low}% / others {other}%")
    if plan.guard:
        until = latest_return(sc) if plan.guard_late else sc.outage_start + sc.outage_hours
        acts.append(
            f"Energy budget: keep enough in the battery for the protected buildings until {_hhmm(until)}"
            + (" (a late grid return)" if plan.guard_late else " (the forecast grid return)")
            + (f" plus a {round((plan.guard - 1) * 100)}% margin" if plan.guard > 1 else "")
            + ", and share the rest evenly over that time"
        )
        bits.append(("budget to late return" if plan.guard_late else "budget to forecast return") + (f" +{round((plan.guard - 1) * 100)}%" if plan.guard > 1 else ""))
    acts.append("Restore every building in stages as soon as the grid returns")
    title = " · ".join(bits)
    return title[0].upper() + title[1:], acts


def _plan_json(key: str, r: RunResult, sc: Scenario) -> dict:
    title, actions = describe(r.plan, sc)
    checks = guardrail(r, sc) if r.plan.ai else []
    share = r.zone_served.mean(0)
    return {
        "key": key,
        "id": r.plan.id,
        "title": title,
        "actions": actions,
        "metrics": metrics(r),
        "zones": [
            {"id": z.id, "name": z.name, "servedPct": round(float(share[i]) * 100), "protected": z.id in sc.protect}
            for i, z in enumerate(ZONES)
        ],
        "checks": checks,
        "passes": all(ch["ok"] for ch in checks) if checks else False,
    }


def _pick(results: list[RunResult], sc: Scenario) -> tuple[dict[str, RunResult], bool]:
    """Cheapest, safest and balanced among the plans the Guardrail lets through."""
    checked = [(r, guardrail(r, sc)) for r in results]
    feasible = [r for r, ch in checked if all(x["ok"] for x in ch)]
    pool = feasible
    if not pool:
        # Nothing passes (e.g. too much protected for this battery): show the closest plans, blocked.
        best = max(int((r.interruption_min <= 1e-6).sum()) for r in results)
        pool = [r for r in results if int((r.interruption_min <= 1e-6).sum()) == best]

    def m(r: RunResult) -> dict:
        return metrics(r)

    safest = max(pool, key=lambda r: (m(r)["protectedRuns"], m(r)["criticalUptimeP10"], m(r)["reserveP10Pct"], m(r)["servedPct"]))
    cheapest = min(pool, key=lambda r: (round(m(r)["costInr"], -2), -m(r)["servedPct"], -m(r)["reserveP10Pct"]))
    lo = float(min(m(r)["costInr"] for r in pool))

    def balanced_score(r: RunResult) -> float:
        mm = m(r)
        cost_rel = (mm["costInr"] - lo) / max(lo, 1.0)  # extra cost as a share of the cheapest
        reserve_n = (mm["reserveP10Pct"] - sc.floor_pct) / max(1.0, 90 - sc.floor_pct)
        return cost_rel + 0.6 * (1 - mm["servedPct"] / 100) + 0.15 * (1 - mm["fairness"] / 100) - 0.1 * reserve_n

    balanced = min(pool, key=balanced_score)
    return {"cheapest": cheapest, "safest": safest, "balanced": balanced}, bool(feasible)


def _replay(tw: Twin, picks: dict[str, RunResult], baseline: RunResult) -> dict:
    """One typical run (the median energy gap), minute by minute, for each recommended plan and the baseline."""
    var = tw.var
    out = (tw.times[None, :] >= var.start[:, None]) & (tw.times[None, :] < var.end[:, None])
    gap = ((tw.base.sum(1)[None, :] * var.demand[:, None] - tw.clear[None, :] * var.solar[:, None]) * out).sum(1) * DT_H
    gap = gap - (var.soc0 - tw.sc.floor_pct) / 100 * c.BATTERY_CAPACITY_KWH
    i = int(np.argsort(gap)[len(gap) // 2])
    series = {}
    keyed = [*picks.items(), ("baseline", baseline)]
    recorded = run_batch(tw, [r.plan for _, r in keyed], record=True)
    for (key, _), rr in zip(keyed, recorded):
        rec = rr.trace
        assert rec is not None
        series[key] = [
            {
                "soc": round(float(rec["soc"][k, i]), 1),
                "servedKw": round(float(rec["served"][k, i])),
                "ok": bool(rec["ok"][k, i]),
            }
            for k in range(len(tw.times))
        ]
        if "demandKw" not in series:
            series["demandKw"] = [round(float(rec["req"][k, i])) for k in range(len(tw.times))]
            series["solarKw"] = [round(float(rec["solar"][k, i])) for k in range(len(tw.times))]
    return {
        "run": i + 1,
        "hours": [round(float(t), 4) for t in tw.times],
        "outageFrom": round(float(var.start[i]), 4),
        "outageTo": round(float(var.end[i]), 4),
        "demandKw": series.pop("demandKw"),
        "solarKw": series.pop("solarKw"),
        "plans": series,
    }


def plan_study(sc: Scenario) -> dict:
    sc = sc.normalised()
    t0 = time.perf_counter()
    var = sample_variants(sc)
    tw = Twin.build(sc, var)
    plans = candidate_plans(sc)
    *results, baseline = run_batch(tw, [*plans, BASELINE])
    picks, any_feasible = _pick(results, sc)
    elapsed = (time.perf_counter() - t0) * 1000

    cands = []
    for r in results:
        mm = metrics(r)
        cands.append(
            {
                "id": r.plan.id,
                "style": r.plan.style,
                "costInr": mm["costInr"],
                "servedPct": mm["servedPct"],
                "protectedRuns": mm["protectedRuns"],
                "fairness": mm["fairness"],
                "reserveP10Pct": mm["reserveP10Pct"],
                "passes": all(x["ok"] for x in guardrail(r, sc)),
            }
        )
    rec = {k: _plan_json(k, r, sc) for k, r in picks.items()}
    for k in rec:
        rec[k]["sameAs"] = [o for o in rec if o != k and rec[o]["id"] == rec[k]["id"]]
    return {
        "studyId": uuid.uuid4().hex[:10],
        "label": "Simulation",
        "scenario": {
            "heatSeverity": sc.heat_severity,
            "solarPct": sc.solar_pct,
            "outageStart": sc.outage_start,
            "outageHours": sc.outage_hours,
            "startSoc": sc.start_soc,
            "runs": sc.runs,
            "floorPct": sc.floor_pct,
            "protect": list(sc.protect),
            "seed": sc.seed,
        },
        "variants": {
            "demandPct": [round(float(var.demand.min()) * 100), round(float(var.demand.max()) * 100)],
            "solarPct": [round(float(var.solar.min()) * 100), round(float(var.solar.max()) * 100)],
            "outageStart": [_hhmm(float(var.start.min())), _hhmm(float(var.start.max()))],
            "outageHours": [round(float((var.end - var.start).min()), 1), round(float((var.end - var.start).max()), 1)],
            "startSoc": [round(float(var.soc0.min())), round(float(var.soc0.max()))],
        },
        "stats": {
            "plans": len(plans),
            "runs": sc.runs,
            "twinRuns": (len(plans) + 1) * sc.runs,
            "elapsedMs": round(elapsed),
            "feasible": sum(1 for x in cands if x["passes"]),
            "stepMin": DT_MIN,
        },
        "anyFeasible": any_feasible,
        "candidates": cands,
        "recommended": rec,
        "baseline": _plan_json("baseline", baseline, sc),
        "replay": _replay(tw, picks, baseline),
        "assumptions": [
            f"{sc.runs} versions of the emergency: demand, solar, outage start and length, and battery charge all vary.",
            "Same buildings, loads, solar and battery limits as the GridNova digital twin.",
            f"Restoration times are modelled: GridNova recloses in stages ({AUTO_PER_BUILDING_MIN * 60:.0f} s per building), a manual crew takes ~{MANUAL_RESTORE_MIN:.0f} min.",
            "Pre-cooling is modelled as hostels using 4% more for an hour, then 8% less for two hours.",
            "Cost is the grid energy bill over the window (before and after the outage).",
        ],
    }
