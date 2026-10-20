"""End-to-end checks of the API contract the website relies on."""

import pytest
from fastapi.testclient import TestClient

from gridnova import campus as c
from gridnova.main import app


@pytest.fixture()
def client():
    with TestClient(app) as cl:
        cl.post("/api/scenarios/clear")
        cl.post("/api/control/mode", json={"mode": "ai"})
        yield cl


def test_grid_state_balances(client):
    g = client.get("/api/grid/state").json()
    # battery powerKw > 0 means charging (a load), < 0 means supplying the campus
    supply = g["solarKw"] + g["gridImportKw"] - g["battery"]["powerKw"]
    assert abs(supply - g["demandKw"]) <= 3  # rounding only
    assert len(g["zones"]) == 10
    assert 20 <= g["battery"]["socPct"] <= 90
    assert g["tariff"]["slab"] in {"off-peak", "normal", "peak"}


def test_forecast_shape(client):
    f = client.get("/api/forecast").json()
    assert f["horizonHours"] == 12 and len(f["points"]) == 12
    assert {"time", "demandKw", "solarKw", "tariffInr"} <= f["points"][0].keys()


@pytest.mark.parametrize("fault", ["cloud_cover", "heatwave", "line_failure"])
def test_scenarios_pick_a_safe_plan(client, fault):
    client.post("/api/scenarios/inject", json={"type": fault, "severity": 3, "durationMin": 30})
    d = client.post("/api/agents/orchestrator/step").json()
    assert d["chosenPlanId"] in {"A", "B"}
    assert [s["kind"] for s in d["steps"]] == ["observe", "reason", "plan", "safety", "act", "result"]
    assert d["outcome"]["recoveryMin"] < d["outcome"]["baselineMin"]
    g = client.get("/api/grid/state").json()
    assert g["activeFault"]["mitigated"] is True
    # Guardrail G1: labs never lose power.
    assert all(z["demandKw"] > 0 for z in g["zones"] if z["kind"] == "lab")


def test_line_failure_reroutes_within_feeder_limit(client):
    client.post("/api/scenarios/inject", json={"type": "line_failure", "severity": 3, "durationMin": 30})
    d = client.post("/api/agents/orchestrator/step").json()
    assert d["chosenPlanId"] == "B"
    gh1 = next(z for z in client.get("/api/grid/state").json()["zones"] if z["id"] == "hostel-gh1")
    assert gh1["status"] == "reduced" and gh1["demandKw"] > 0


def test_replay_is_faster_and_reuses_the_lesson(client):
    from gridnova.main import orchestrator

    orchestrator.plans.entries.clear()  # start with an empty Critic memory
    times, runs = [], []
    for _ in range(2):
        client.post("/api/scenarios/clear")
        client.post("/api/scenarios/inject", json={"type": "cloud_cover", "severity": 3, "durationMin": 30})
        d = client.post("/api/agents/orchestrator/step").json()
        times.append(d["outcome"]["recoveryMin"])
        runs.append(d["search"]["twinRuns"])
    # Run 2 recalls run 1's plan, so the search needs fewer twin runs: a faster response.
    assert runs[1] < runs[0] and times[1] < times[0]
    assert d["outcome"].get("lessonApplied") and d["usedMemory"]


def test_grid_outage_waits_for_approval(client):
    client.post("/api/scenarios/inject", json={"type": "grid_outage", "severity": 3, "durationMin": 30})
    d = client.post("/api/agents/orchestrator/step").json()
    assert d["approval"]["status"] == "pending"
    assert client.get("/api/grid/state").json()["activeFault"]["mitigated"] is False
    d2 = client.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "modify", "optionId": d["approval"]["modifyOptions"][0]["id"]}).json()
    assert d2["approval"]["status"] == "modified"
    g = client.get("/api/grid/state").json()
    assert g["gridImportKw"] == 0 and g["activeFault"]["mitigated"] is True
    hostels = [z for z in g["zones"] if z["kind"] == "hostel"]
    assert all(z["status"] == "reduced" for z in hostels)
    # A second answer to the same decision is refused.
    assert client.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "approve"}).status_code == 404


def test_results_are_consistent(client):
    r = client.get("/api/results").json()
    gm = sum(p["gridnova"] for p in r["cost"])
    base = sum(p["baseline"] for p in r["cost"])
    assert abs((1 - gm / base) * 100 - r["headline"]["costSavedPct"]) < 0.2
    assert r["headline"]["peakReducedPct"] > 10
    assert r["runs"][2]["recoveryMin"] == r["headline"]["recovery"]["gridnovaMin"]
    assert [x["run"] for x in r["runs"]] == [1, 2, 3]


def test_goal_and_mode(client):
    ack = client.post("/api/goal", json={"goal": "Prepare for a storm"}).json()
    assert "60%" in ack["interpretation"]
    client.post("/api/goal", json={"goal": "Keep labs at full power and keep tonight's bill low."})
    assert client.post("/api/control/mode", json={"mode": "manual"}).json()["mode"] == "manual"
    assert client.get("/api/grid/state").json()["mode"] == "manual"


def test_memory_and_agents(client):
    m = client.get("/api/memory").json()
    assert len(m["incidents"]) >= 4 and m["lessons"]
    agents = client.get("/api/agents").json()
    assert {a["id"] for a in agents} == {"orchestrator", "forecaster", "zone", "planner", "fault", "critic", "guardrail"}
    assert len(client.get("/api/guardrails").json()) == 6


def test_bad_input_is_rejected(client):
    assert client.post("/api/scenarios/inject", json={"type": "meteor"}).status_code == 422
    assert client.post("/api/scenarios/inject", json={"type": "line_failure", "targetZoneId": "nope"}).status_code == 400
    assert client.get("/api/does-not-exist").status_code == 404


def test_battery_constants_match_the_guardrails():
    assert c.BATTERY_FLOOR_PCT == 20 and c.BATTERY_CEIL_PCT == 90
    assert c.CONTRACT_LIMIT_KW == 1600


def test_environment_and_clock(client):
    env = client.get("/api/grid/state").json()["environment"]
    assert env["clock"] in {"live", "demo"} and env["weatherSource"] in {"open-meteo", "profile"}
    demo = client.post("/api/sim", json={"clock": "demo", "speed": 60}).json()
    assert demo["clock"] == "demo" and demo["speed"] == 60
    assert client.get("/api/grid/state").json()["timestamp"][11:16] == "17:20"
    live = client.post("/api/sim", json={"clock": "live", "speed": 1}).json()
    assert live["clock"] == "live" and live["speed"] == 1
    assert client.post("/api/sim", json={"clock": "warp", "speed": 1}).status_code == 422


def test_what_if_changes_the_results(client):
    base = client.get("/api/results").json()["headline"]
    none = client.post("/api/results/whatif", json={"batteryKwh": 0, "solarPct": 100, "peakRate": 9.7, "tempOffsetC": 0}).json()
    big = client.post("/api/results/whatif", json={"batteryKwh": 4000, "solarPct": 100, "peakRate": 9.7, "tempOffsetC": 0}).json()
    assert none["headline"]["peakReducedPct"] < base["peakReducedPct"] < big["headline"]["peakReducedPct"] + 0.01
    assert none["headline"]["costSavedPct"] < big["headline"]["costSavedPct"]
    assert big["settings"]["batteryKwh"] == 4000
    assert client.post("/api/results/whatif", json={"batteryKwh": -5}).status_code == 422


def test_control_state_survives_a_reload(client):
    client.post("/api/control/mode", json={"mode": "fallback"})
    client.post("/api/goal", json={"goal": "Protect battery health; avoid deep discharge."})
    state = client.get("/api/control").json()
    assert state["mode"] == "fallback" and "battery" in state["goal"].lower() and "40%" in state["interpretation"]
    client.post("/api/goal", json={"goal": "Keep labs at full power and keep tonight's bill low."})


def test_weather_drives_solar_and_demand():
    from datetime import datetime

    from gridnova.grid import IST, LiveGrid
    from gridnova.weather import Weather

    def weather(ghi, temp):
        w = Weather(fetch=False)
        hours = [f"2026-10-13T{h:02d}:00" for h in range(24)]
        w.load({"hourly": {"time": hours, "temperature_2m": [temp] * 24, "shortwave_radiation": [ghi] * 24, "cloud_cover": [10] * 24}})
        return w

    noon = datetime(2026, 10, 13, 12, 30, tzinfo=IST).timestamp()
    sunny = LiveGrid(weather(900, 30), wall=lambda: noon).snapshot()
    cloudy = LiveGrid(weather(250, 30), wall=lambda: noon).snapshot()
    hot = LiveGrid(weather(900, 42), wall=lambda: noon).snapshot()
    assert sunny.solar_kw > cloudy.solar_kw * 3
    assert hot.demand_kw > sunny.demand_kw


def test_campus_can_move_anywhere_in_india(client):
    found = client.get("/api/locations/search", params={"q": "chen"}).json()
    chennai = next(p for p in found["results"] if p["name"] == "Chennai")
    assert chennai["state"] == "Tamil Nadu" and chennai["discom"]
    before = client.get("/api/results").json()["cost"][0]["baseline"]
    loc = client.post("/api/location", json={k: chennai[k] for k in ("name", "state", "lat", "lon")}).json()
    assert loc["name"] == "Chennai" and loc["tariff"]["peak"] == chennai["tariff"]["peak"]
    env = client.get("/api/grid/state").json()["environment"]
    assert env["location"] == "Chennai" and env["state"] == "Tamil Nadu"
    assert client.get("/api/results").json()["cost"][0]["baseline"] != before  # new state's tariff
    assert client.post("/api/location", json={"name": "London", "state": "", "lat": 51.5, "lon": -0.1}).status_code == 422
    lucknow = client.get("/api/locations/search", params={"q": "luck"}).json()["results"][0]
    client.post("/api/location", json={k: lucknow[k] for k in ("name", "state", "lat", "lon")})

def test_manual_mode_expires_back_to_ai():
    from gridnova.grid import LiveGrid

    now = [1_000_000.0]
    g = LiveGrid(wall=lambda: now[0], clock_mode="demo")
    g.set_mode("fallback")
    assert not g.expire_mode(600)  # just switched on: stays
    now[0] += 601
    assert g.expire_mode(600) and g.mode == "ai"
    assert not g.expire_mode(600)  # already AI
    g.set_mode("manual")
    now[0] += 10_000
    assert not g.expire_mode(0)  # ttl 0 = never expire


def test_sign_in_roles_and_protection(monkeypatch):
    from fastapi.testclient import TestClient
    from gridnova import auth
    from gridnova.main import app

    monkeypatch.setenv("GRIDNOVA_AUTH", "on")
    monkeypatch.setenv("GRIDNOVA_USERS", "asha:pw-op:operator,guest:pw-view:viewer")
    auth.reload_users()
    try:
        c = TestClient(app)
        assert c.get("/api/health").status_code == 200  # open
        assert c.get("/api/grid/state").status_code == 401  # needs sign-in
        assert c.post("/api/auth/login", json={"username": "asha", "password": "nope"}).status_code == 401
        assert c.get("/api/auth/demo").json()["accounts"] == []  # real accounts: no demo hints

        op = c.post("/api/auth/login", json={"username": "Asha", "password": "pw-op"}).json()
        vw = c.post("/api/auth/login", json={"username": "guest", "password": "pw-view"}).json()
        assert op["user"] == {"name": "asha", "role": "operator"}
        h_op = {"Authorization": f"Bearer {op['token']}"}
        h_vw = {"Authorization": f"Bearer {vw['token']}"}

        assert c.get("/api/grid/state", headers=h_vw).status_code == 200  # viewers can look
        assert c.post("/api/control/mode", json={"mode": "ai"}, headers=h_vw).status_code == 403  # not act
        assert c.post("/api/control/mode", json={"mode": "ai"}, headers=h_op).status_code == 200
        assert c.get("/api/auth/me", headers=h_vw).json()["role"] == "viewer"
        assert c.get("/api/grid/state", headers={"Authorization": "Bearer " + op["token"][:-3] + "abc"}).status_code == 401
    finally:
        monkeypatch.undo()
        auth.reload_users()


def test_token_expiry_and_lockout():
    from gridnova import auth

    u = auth.User("x", "viewer")
    t, exp = auth.issue(u, now=1000.0)
    assert auth.verify(t, now=1001.0) == u and auth.verify(t, now=exp + 1) is None
    for _ in range(auth.MAX_FAILS):
        assert auth.authenticate("nobody", "bad", client="1.2.3.4", now=5000.0) is None
    try:
        auth.authenticate("nobody", "bad", client="1.2.3.4", now=5001.0)
        raise AssertionError("expected lockout")
    except PermissionError:
        pass
