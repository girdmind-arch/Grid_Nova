"""Trains GridNova's own models and measures them on days they never saw.

    cd backend && python -m gridnova.ml.train            # full training (~2 minutes on a laptop)
    cd backend && python -m gridnova.ml.train --quick    # small run for a smoke test

1. Forecaster: a neural network learns next-12-hour demand from simulated history
   (300 training days, 60 held-out days), compared with two simple forecasts.
2. Planner: a Q-learning agent learns battery control over 40,000 simulated days, seeing
   forecasts with the same error as the trained Forecaster.
3. Evaluation in the full campus simulator on 30 held-out days: no AI, the rule-based
   planner (a peak cap sized with perfect knowledge of the day), and the learned agent
   driven by the learned Forecaster's rolling forecasts.

Writes models/forecaster.json, models/planner_q.json and models/metrics.json.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .. import campus as c
from ..simulator import Policy, best_peak_target, simulate
from .env import STORED_VALUE, make_day
from .forecaster import HORIZON, LearnedForecaster, baselines, history, rolling_ahead
from .nn import MLP
from .qagent import QAgent

MODELS = Path(__file__).parent / "models"


def day_cost(tot, start_soc: float, end_soc: float) -> float:
    """What the day really cost: energy + penalties + demand charge - change in stored energy."""
    stored = (end_soc - start_soc) / 100 * c.BATTERY_CAPACITY_KWH * STORED_VALUE()
    return tot.cost_inr + tot.max_import_kw * c.DEMAND_CHARGE_INR_PER_KW_DAY - stored


LOADS = dict(precool=True, hvac_trim=True)


def evaluate(agent: QAgent, forecaster: LearnedForecaster | None, days: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    rows = []
    for k in range(days):
        d = make_day(rng)
        cond, soc = d.cond, d.start_soc
        bat, tot, _ = simulate(0, 24, cond, Policy.baseline(), soc, dt_min=5)
        none = day_cost(tot, soc, bat.soc_pct)
        rule_pol = Policy(ai=True, night_charge_to_pct=82.0, **LOADS)
        b17, _, _ = simulate(0, 17, cond, rule_pol, soc, dt_min=5)
        rule_pol = replace(rule_pol, peak_target_kw=best_peak_target(17, cond, rule_pol, b17.soc_pct))
        bat, tot, _ = simulate(0, 24, cond, rule_pol, soc, dt_min=5)
        rules = day_cost(tot, soc, bat.soc_pct)
        rl_pol = Policy(ai=True, night_charge_to_pct=None, controller=agent.controller(rolling_ahead(forecaster, cond)), **LOADS)
        bat, tot_rl, _ = simulate(0, 24, cond, rl_pol, soc, dt_min=5)
        rl = day_cost(tot_rl, soc, bat.soc_pct)
        rows.append({"day": k + 1, "noAiInr": round(none), "rulesInr": round(rules), "learnedInr": round(rl),
                     "learnedPeakKw": round(tot_rl.max_import_kw), "learnedMinSoc": round(tot_rl.min_soc_pct, 1)})
    mean = lambda key: float(np.mean([r[key] for r in rows]))  # noqa: E731
    none, rules, rl = mean("noAiInr"), mean("rulesInr"), mean("learnedInr")
    return {
        "days": days,
        "avgNoAiInr": round(none), "avgRulesInr": round(rules), "avgLearnedInr": round(rl),
        "learnedSavedVsNoAiPct": round((1 - rl / none) * 100, 2),
        "rulesSavedVsNoAiPct": round((1 - rules / none) * 100, 2),
        "learnedVsRulesInr": round(rules - rl),
        "learnedBeatsRulesDays": sum(r["learnedInr"] < r["rulesInr"] for r in rows),
        "minSocPct": min(r["learnedMinSoc"] for r in rows),
        "perDay": rows,
    }


def scenario_learning(models_dir: Path) -> list[dict]:
    """Runs each scenario three times on a fresh demo campus with the agents just trained.

    Run 1 starts with an empty Critic memory; runs 2 and 3 can recall run 1. Recovery time is
    detect + analyse (twin runs the search needed) + act (switching), see agents.py.
    """
    from . import runtime
    from ..agents import Orchestrator, manual_minutes
    from ..grid import LiveGrid
    from ..memory import Memory

    runtime.MODELS = models_dir
    runtime.FORECASTER, runtime.PLANNER_Q, runtime.METRICS = runtime._load()
    out = []
    for typ in ("cloud_cover", "heatwave", "line_failure", "grid_outage"):
        grid = LiveGrid(clock_mode="demo")
        orch = Orchestrator(grid, Memory())
        runs = []
        for run in (1, 2, 3):
            grid.clear_fault()
            grid.start_fault(typ, 3, 30, None)
            d = orch.step()
            if d.get("approval", {}).get("status") == "pending":
                orch.respond(d["id"], {"decision": "approve"})
            o = d["outcome"]
            runs.append({"run": run, "recoveryMin": o["recoveryMin"], "twinRuns": o["breakdown"]["twinRuns"],
                         "plan": d["plans"][1]["title"], "costInr": d["plans"][1]["costInr"],
                         **({"lessonApplied": o["lessonApplied"]} if o.get("lessonApplied") else {})})
        out.append({"type": typ, "baselineMin": manual_minutes(typ, 3), "runs": runs})
    return out


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="small run (smoke test), does not overwrite models unless --out")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args(argv)
    out = args.out or (MODELS if not args.quick else Path("/tmp/gridnova-models"))
    out.mkdir(parents=True, exist_ok=True)
    q = args.quick
    t0 = time.time()

    # 1) Forecaster
    print("Forecaster: generating simulated history ...")
    X, Y, _ = history(40 if q else 300, seed=1)
    Xv, Yv, rv = history(15 if q else 60, seed=2)
    net = MLP([X.shape[1], 48, 48, HORIZON], seed=0)
    curve_f = net.fit(X, Y, epochs=10 if q else 80, X_val=Xv, Y_val=Yv)
    mae = float(np.mean(np.abs(net.predict(Xv) - Yv)))
    mape = float(np.mean(np.abs(net.predict(Xv) - Yv) / Yv))
    by_h = np.mean(np.abs(net.predict(Xv) - Yv), axis=0)
    base = baselines(rv, Yv)
    net.save(out / "forecaster.json")
    print(f"  held-out MAE {mae:.1f} kW ({mape * 100:.1f}%), typical-day profile {base['typicalDayProfile']:.1f} kW")

    # 2) Planner (Q-learning), seeing forecasts as wrong as the Forecaster is
    episodes = 2000 if q else 40000
    print(f"Planner: Q-learning over {episodes:,} simulated days ...")
    agent = QAgent()
    curve_q = agent.train(episodes, seed=3, forecast_noise=round(mape, 3), report_every=max(100, episodes // 40))
    agent.save(out / "planner_q.json")
    print(f"  last 1,000 days: saved ₹{curve_q[-1]['avgSavedInr']:,}/day vs an idle battery")

    # 3) Held-out evaluation in the full simulator
    print("Evaluating on held-out days in the campus simulator ...")
    ev = evaluate(agent, LearnedForecaster(net), 6 if q else 30, seed=2026)
    print(f"  no AI ₹{ev['avgNoAiInr']:,} · rules ₹{ev['avgRulesInr']:,} · learned ₹{ev['avgLearnedInr']:,} per day")

    metrics = {
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "trainingSeconds": round(time.time() - t0),
        "forecaster": {
            "model": f"Neural network {X.shape[1]}-48-48-{HORIZON}, tanh, trained with Adam (numpy, written for GridNova)",
            "trainExamples": int(len(X)), "validationExamples": int(len(Xv)),
            "maeKw": round(mae, 1), "mapePct": round(mape * 100, 2),
            "maeByHourAheadKw": [round(float(x), 1) for x in by_h],
            "baselineMaeKw": {k: round(v, 1) for k, v in base.items()},
            "curve": [{"epoch": r["epoch"], "trainMse": round(r["trainMse"]), "valMse": round(r["valMse"])} for r in curve_f],
        },
        "planner": {
            "model": "Tabular Q-learning, 24 h × 10 battery × 7 load × 4 peak-margin × 5 forecast states, 8 actions",
            "episodes": episodes,
            "statesVisited": int((agent.visits.sum(axis=-1) > 0).sum()),
            "forecastNoisePct": round(mape * 100, 2),
            "curve": curve_q,
            "evaluation": ev,
        },
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=1))
    print("Scenarios: three runs each with the trained agents ...")
    metrics["scenarios"] = scenario_learning(out)
    for s_ in metrics["scenarios"]:
        print(f"  {s_['type']}: " + " -> ".join(f"{r['recoveryMin']} min ({r['twinRuns']} twin runs)" for r in s_["runs"]))
    (out / "metrics.json").write_text(json.dumps(metrics, indent=1))
    print(f"Done in {metrics['trainingSeconds']} s -> {out}")
    return metrics


if __name__ == "__main__":
    main()
