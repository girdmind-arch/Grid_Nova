"""Resilience Autopilot: the many-runs outage planner (simulation only)."""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from gridnova import autopilot as ap
from gridnova import campus as c
from gridnova.main import app


@pytest.fixture(scope="module")
def study():
    return ap.plan_study(ap.Scenario())


def test_study_shape_and_label(study):
    assert study["label"] == "Simulation"
    assert study["stats"]["runs"] == 40
    assert study["stats"]["twinRuns"] == (study["stats"]["plans"] + 1) * 40
    assert set(study["recommended"]) == {"cheapest", "safest", "balanced"}
    assert len(study["candidates"]) == study["stats"]["plans"]
    rp = study["replay"]
    assert len(rp["hours"]) == len(rp["demandKw"]) == len(rp["plans"]["baseline"])
    assert set(rp["plans"]) == {"cheapest", "safest", "balanced", "baseline"}


def test_default_scenario_has_safe_plans_that_beat_the_baseline(study):
    assert study["anyFeasible"]
    base = study["baseline"]["metrics"]
    for plan in study["recommended"].values():
        assert plan["passes"], plan["checks"]
        m = plan["metrics"]
        assert m["protectedRuns"] >= 38  # G1: >= 95% of 40 runs
        assert m["criticalUptimePct"] > base["criticalUptimePct"]
        assert m["recoveryMin"] < base["recoveryMin"]
        assert m["fairness"] >= base["fairness"]
        assert m["reserveP10Pct"] >= study["scenario"]["floorPct"] - 0.5


def test_picks_are_ordered(study):
    rec = study["recommended"]
    assert rec["cheapest"]["metrics"]["costInr"] <= rec["safest"]["metrics"]["costInr"]
    assert rec["cheapest"]["metrics"]["costInr"] <= rec["balanced"]["metrics"]["costInr"]
    assert rec["safest"]["metrics"]["protectedRuns"] >= rec["balanced"]["metrics"]["protectedRuns"]


def test_battery_limits_hold_in_every_run():
    sc = ap.Scenario().normalised()
    var = ap.sample_variants(sc)
    tw = ap.Twin.build(sc, var)
    for r in ap.run_batch(tw, [*ap.candidate_plans(sc), ap.BASELINE]):
        assert r.min_soc.min() >= sc.floor_pct - 1e-6
        assert (r.reserve <= c.BATTERY_CEIL_PCT + 1e-6).all()
        assert (r.over_contract <= 1e-6).all()  # pre-charging never adds import above the contract
        assert (r.uptime_pct >= -1e-6).all() and (r.uptime_pct <= 100 + 1e-6).all()


def test_batched_twin_matches_single_runs():
    sc = ap.Scenario(runs=12).normalised()
    tw = ap.Twin.build(sc, ap.sample_variants(sc))
    plans = ap.candidate_plans(sc)[::40]
    batch = ap.run_batch(tw, plans)
    for p, b in zip(plans, batch):
        one = ap.run_plan(tw, p)
        assert np.allclose(one.cost, b.cost) and np.allclose(one.reserve, b.reserve)


def test_protecting_too_much_is_blocked_by_the_guardrail():
    hostels = tuple(z.id for z in c.ZONES if z.kind == "hostel")
    s = ap.plan_study(ap.Scenario(protect=hostels))
    assert not s["anyFeasible"]
    assert all(not p["passes"] for p in s["recommended"].values())
    assert any(ch["id"] == "G1" and not ch["ok"] for ch in s["recommended"]["safest"]["checks"])


def test_labs_are_always_protected():
    s = ap.plan_study(ap.Scenario(protect=("library",), runs=10))
    assert set(s["scenario"]["protect"]) == {"lab-electrical", "lab-cs", "library"}


def test_api_endpoint():
    with TestClient(app) as cl:
        r = cl.post("/api/autopilot/plan", json={"runs": 10, "protect": ["library"]})
        assert r.status_code == 200
        assert r.json()["scenario"]["runs"] == 10
        assert cl.post("/api/autopilot/plan", json={"protect": ["nope"]}).status_code == 400
        assert cl.post("/api/autopilot/plan", json={"runs": 500}).status_code == 422


def test_agents_study_runs_the_real_planner_without_touching_the_grid():
    with TestClient(app) as cl:
        cl.post("/api/scenarios/clear")
        before = cl.get("/api/grid/state").json()
        trace_before = len(cl.get("/api/agents/trace").json())
        r = cl.post("/api/agents/study", json={"type": "grid_outage", "severity": 4, "durationMin": 60})
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["search"]["twinRuns"] > 0
        assert {ch["id"] for ch in s["chosen"]["checks"]} >= {"G1", "G2"}
        n = len(s["series"]["hours"])
        assert n > 0 and len(s["series"]["gridnova"]["socPct"]) == n == len(s["series"]["baseline"]["servedKw"])
        assert all(g == 0 for g in s["series"]["gridnova"]["gridKw"][:5])  # islanded during the outage
        after = cl.get("/api/grid/state").json()
        assert after.get("activeFault") is None and before.get("activeFault") is None
        assert len(cl.get("/api/agents/trace").json()) == trace_before  # no decision recorded
        assert cl.post("/api/agents/study", json={"type": "nope"}).status_code == 422
