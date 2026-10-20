"""Checks that the agents' learning is real: models train, generalise, and are used."""

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from gridnova import campus as c
from gridnova.main import app
from gridnova.ml import runtime
from gridnova.ml.env import make_day, run_day
from gridnova.ml.forecaster import LearnedForecaster, baselines, history
from gridnova.ml.nn import MLP
from gridnova.ml.qagent import ACTIONS, QAgent
from gridnova.simulator import dispatch_setpoint


def test_neural_network_learns_a_function():
    rng = np.random.default_rng(0)
    X = rng.uniform(-3, 3, (600, 1))
    Y = np.sin(X)
    net = MLP([1, 16, 1], seed=1)
    curve = net.fit(X, Y, epochs=80, lr=1e-2)
    assert curve[-1]["trainMse"] < 0.2 * curve[0]["trainMse"]
    assert float(np.mean(np.abs(net.predict(X) - Y))) < 0.1


def test_battery_physics_limits_every_setpoint():
    cap = c.BATTERY_CAPACITY_KWH
    assert dispatch_setpoint(5000, 50, 1200, 0.25, cap, 20) <= c.BATTERY_MAX_KW  # inverter rating
    assert dispatch_setpoint(500, 20, 1200, 0.25, cap, 20) == 0  # at the reserve floor
    assert dispatch_setpoint(-400, 90, 600, 0.25, cap, 20) == 0  # full
    assert dispatch_setpoint(800, 60, 300, 0.25, cap, 20) == 300  # never exports
    assert dispatch_setpoint(-400, 50, 1500, 0.25, cap, 20) >= -(c.CONTRACT_LIMIT_KW - 1500)  # charging keeps import legal


def test_shipped_forecaster_beats_a_typical_day_profile_on_unseen_days():
    assert runtime.FORECASTER is not None, "run python -m gridnova.ml.train"
    X, Y, rows = history(8, seed=12345)  # days the network never trained on
    mae = float(np.mean(np.abs(runtime.FORECASTER.net.predict(X) - Y)))
    assert mae < 0.7 * baselines(rows, Y)["typicalDayProfile"]


def test_shipped_planner_policy_saves_money_on_unseen_days():
    assert runtime.PLANNER_Q is not None, "run python -m gridnova.ml.train"
    rng = np.random.default_rng(777)
    saved = [run_day(d, runtime.PLANNER_Q.act)["savedInr"] for d in (make_day(rng) for _ in range(8))]
    assert np.mean(saved) > 1000  # ₹ per day versus leaving the battery idle


def test_q_agent_improves_with_training_and_round_trips(tmp_path):
    agent = QAgent()
    curve = agent.train(600, seed=5, report_every=200)
    assert curve[-1]["avgSavedInr"] > curve[0]["avgSavedInr"]
    agent.save(tmp_path / "q.json")
    again = QAgent.load(tmp_path / "q.json")
    state = (19.0, 70.0, 1400.0, 1200.0, 1500.0)
    assert again.best_action(state) == agent.best_action(state)
    assert 0 <= agent.best_action(state) < len(ACTIONS)


def test_forecaster_keeps_learning_from_the_meters():
    net = MLP.from_dict(runtime.FORECASTER.net.to_dict())
    f = LearnedForecaster(net)
    before = [w.copy() for w in net.W]
    for h in range(30):  # 30 hours of readings: the first forecasts can now be checked
        f.observe(1000 + h, 1000 + 200 * math.sin(h / 4), 34.0, [34.0] * 12)
    assert f.online_updates > 0 and f.live_errors
    assert any(not np.allclose(a, b) for a, b in zip(before, net.W))


@pytest.fixture()
def client():
    with TestClient(app) as cl:
        cl.post("/api/scenarios/clear")
        yield cl


def test_plans_come_from_a_search_not_a_list(client):
    client.post("/api/scenarios/inject", json={"type": "line_failure", "severity": 3, "durationMin": 30})
    d = client.post("/api/agents/orchestrator/step").json()
    assert d["search"]["twinRuns"] > 2 and d["outcome"]["breakdown"]["twinRuns"] == d["search"]["twinRuns"]
    # The reroute share is found by the search, so it stays under the feeder limit instead of a fixed value.
    gh1 = next(z for z in client.get("/api/grid/state").json()["zones"] if z["id"] == "hostel-gh1")
    assert 0 < gh1["demandKw"]


def test_learning_endpoint(client):
    j = client.get("/api/learning").json()
    assert j["available"] == {"forecaster": True, "plannerPolicy": True}
    t = j["trained"]
    assert t["forecaster"]["maeKw"] < t["forecaster"]["baselineMaeKw"]["typicalDayProfile"]
    assert t["planner"]["evaluation"]["avgLearnedInr"] < t["planner"]["evaluation"]["avgNoAiInr"]
    assert len(t["scenarios"]) == 4
    f = client.get("/api/forecast").json()
    assert f["model"]["maeKw"] == t["forecaster"]["maeKw"]
