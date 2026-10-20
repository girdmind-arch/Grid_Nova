"""The recommended build: one INA219 after the relay, an adapter-sense divider, three LED branches.

Everything talks to a mocked device. The rig drives the demo: unplugging the adapter starts the
campus grid outage, plugging it back in ends it.
"""

import pytest
from fastapi.testclient import TestClient

from gridnova import hardware as hw
from gridnova.main import app, grid

KEY = "k3y-for-tests-only-0123456789abcdef"
DEV = "esp32-test-02"
T0 = 1_790_000_000.0
LOADS3 = {"critical": True, "hostel": True, "library": True}


class Rig:
    def __init__(self, client, clock):
        self.c, self.clock, self.seq = client, clock, 0
        self.h = {"X-Device-Id": DEV, "Authorization": f"Bearer {KEY}"}
        self.source, self.loads, self.adapter = "adapter", dict(LOADS3), True

    @property
    def now(self):
        return self.clock["t"]

    def tel(self, **over):
        self.seq += 1
        on = sum(self.loads.values())
        supplied = self.adapter if self.source == "adapter" else True
        body = {
            "deviceId": DEV, "bootId": "boot2", "seq": self.seq, "ts": self.now, "firmware": "0.2.0", "source": self.source,
            "output": {"voltageV": 5.06 if supplied else 0.02, "currentA": (0.0012 + 0.0175 * on) if supplied else 0.0},
            "adapterPresent": self.adapter, "adapterSenseV": 5.08 if self.adapter else 0.04,
            "loads": dict(self.loads),
            "health": {"ina219Output": "ok", "adapterSense": "ok", "muxInterlock": "ok"}, "estop": False, "uptimeS": 50,
        }
        body.update(over)
        return body

    def send(self, **over):
        return self.c.post("/api/hardware/device/telemetry", json=self.tel(**over), headers=self.h)

    def tick(self, seconds=2.0, **over):
        self.clock["t"] += seconds
        return self.send(**over)

    def run_commands(self):
        """Behaves like the firmware: applies every command it receives and acknowledges it."""
        cmds = self.c.get("/api/hardware/device/commands", headers=self.h).json()["commands"]
        for cm in cmds:
            if cm["type"] == "select_source":
                self.source = cm["params"]["source"]
            elif cm["type"] == "set_load":
                self.loads[cm["params"]["load"]] = cm["params"]["on"]
            self.c.post(f"/api/hardware/device/commands/{cm['id']}/ack",
                        json={"deviceId": DEV, "result": "applied", "ts": self.now, "source": self.source, "loads": self.loads}, headers=self.h)
        return cmds

    def state(self):
        return self.c.get("/api/hardware/state").json()


@pytest.fixture()
def rig(monkeypatch):
    clock = {"t": T0}
    hw.service.reset()
    hw.service.configure(f"{DEV}:{KEY}")
    monkeypatch.setattr(hw.service, "clock", lambda: clock["t"])
    with TestClient(app) as client:
        client.post("/api/scenarios/clear")
        client.post("/api/control/mode", json={"mode": "ai"})
        yield Rig(client, clock)
        client.post("/api/scenarios/clear")
    hw.service.reset()
    hw.service.configure("")


def arm(rig):
    assert rig.send().status_code == 200
    assert rig.c.post("/api/hardware/mode", json={"mode": "hardware-demo"}).status_code == 200
    r = rig.c.post("/api/hardware/arm", json={"minutes": 10})
    assert r.status_code == 200, r.text


def test_single_sensor_telemetry_is_accepted_and_shown(rig):
    assert rig.send().status_code == 200, rig.send().text
    s = rig.state()
    d = s["device"]
    assert d["sensorLayout"] == "output" and d["branches"] == ["critical", "hostel", "library"]
    assert d["readings"]["output"]["voltageV"] == pytest.approx(5.06) and d["readings"]["adapter"] is None
    assert d["adapter"]["sensed"] is True
    assert [l["name"] for l in s["capabilities"]["loads"]] == ["critical", "hostel", "library"]


def test_rejects_inconsistent_single_sensor_payloads(rig):
    assert rig.send(health={"ina219Output": "fault", "adapterSense": "ok"}).status_code == 422  # value from a faulty sensor
    assert rig.send(health={"adapterSense": "ok"}).status_code == 422  # reading for an unlisted sensor
    assert rig.send(output=None, health={"adapterSense": "ok"}).status_code == 422  # no current sensor at all
    assert rig.send(health={"ina219Output": "ok", "adapterSense": "missing"}).status_code == 422  # sense value from a missing input
    assert rig.send(loads={"critical": True, "fan": True}).status_code == 422  # unknown branch name


def test_commands_for_a_branch_the_rig_does_not_have_are_refused(rig):
    arm(rig)
    r = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True})
    assert r.status_code == 422 and "no 'extra' branch" in r.json()["detail"]


def test_the_rig_model_learns_each_branch_current_from_readings(rig):
    real = {"critical": 0.021, "hostel": 0.016, "library": 0.024}
    combos = [dict(zip(real, bits)) for bits in [(1, 1, 1), (1, 0, 0), (1, 1, 0), (1, 0, 1), (1, 1, 1), (1, 0, 0)] * 6]
    for c in combos:
        loads = {k: bool(v) for k, v in c.items()}
        current = 0.002 + sum(real[k] for k, v in loads.items() if v)
        assert rig.tick(output={"voltageV": 5.05, "currentA": current}, loads=loads).status_code == 200
    m = rig.state()["device"]["model"]
    assert m["confident"]
    for k, a in real.items():
        assert m["branchMa"][k] == pytest.approx(a * 1000, abs=2.0)


def test_unplugging_the_adapter_drives_the_campus_outage_and_back(rig):
    arm(rig)
    rig.run_commands()
    rig.adapter = False  # physically unplugged
    rig.tick()
    assert grid.fault is None  # debounced: one reading is not enough
    rig.tick()
    f = grid.fault
    assert f is not None and f.type == "grid_outage" and f.origin == "rig"
    g = rig.c.get("/api/grid/state").json()["activeFault"]
    assert g["origin"] == "rig" and "adapter" in g["note"]
    # The agents planned it: the decision waits for approval, the rig already moved to the power bank.
    d = next(x for x in rig.c.get("/api/agents/trace").json() if x.get("incidentId") == f.incident_id)
    assert d["approval"]["status"] == "pending" and "rig" in d["trigger"].lower()
    cmds = rig.run_commands()
    assert [c["type"] for c in cmds] == ["select_source"] and rig.source == "powerbank"
    # Approving releases the shedding to the rig.
    opt = d["approval"]["modifyOptions"][0]["id"]
    assert rig.c.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "modify", "optionId": opt}).status_code == 200
    rig.tick()
    rig.run_commands()
    assert rig.loads["critical"] is True
    # Plugged back in: after the debounce the outage ends and the rig goes back to the adapter.
    rig.adapter = True
    for _ in range(3):
        rig.tick()
    assert grid.fault is None
    rig.tick()
    rig.run_commands()
    assert rig.source == "adapter" and all(rig.loads.values())


def test_unplugging_in_simulation_mode_changes_nothing(rig):
    assert rig.send().status_code == 200  # hardware demo mode is off
    rig.adapter = False
    for _ in range(3):
        rig.tick()
    assert grid.fault is None
    assert any("not supplying" in e["text"] for e in rig.state()["events"])


def test_outage_without_arming_runs_the_campus_but_sends_nothing(rig):
    assert rig.send().status_code == 200
    assert rig.c.post("/api/hardware/mode", json={"mode": "hardware-demo"}).status_code == 200
    rig.adapter = False
    rig.tick()
    rig.tick()
    assert grid.fault is not None and grid.fault.origin == "rig"
    assert rig.run_commands() == []


def test_overcurrent_trips_the_emergency_stop(rig):
    arm(rig)
    rig.tick(output={"voltageV": 4.9, "currentA": 1.4})
    s = rig.state()
    assert s["estop"]["active"] and not s["armed"]
    assert any(c["type"] == "estop" for c in rig.c.get("/api/hardware/device/commands", headers=rig.h).json()["commands"])


def test_power_bank_keep_alive_warning_and_shutdown_event(rig):
    rig.source = "powerbank"
    rig.loads = {"critical": True, "hostel": False, "library": False}
    rig.tick()
    w = rig.state()["device"]["warnings"]
    assert any("keep a branch on" in x for x in w)
    rig.tick(output={"voltageV": 0.01, "currentA": 0.0})
    assert any("power bank stopped supplying" in e["text"] for e in rig.state()["events"])


def test_firmware_transfers_by_itself_and_the_server_still_restores_the_adapter(rig):
    arm(rig)
    assert rig.c.get("/api/hardware/device/status", headers=rig.h).json()["control"]["autoTransfer"] is True
    rig.adapter, rig.source = False, "powerbank"  # the firmware's local automatic transfer already happened
    rig.tick()
    rig.tick()
    assert grid.fault is not None and grid.fault.origin == "rig"
    assert [c["type"] for c in rig.run_commands()] == []  # nothing to transfer: already on the power bank
    rig.adapter = True
    for _ in range(4):
        rig.tick()
    assert grid.fault is None
    rig.run_commands()
    assert rig.source == "adapter"


def test_not_switching_back_to_an_adapter_that_is_still_dead(rig):
    arm(rig)
    rig.adapter = False
    rig.tick()
    rig.tick()
    rig.run_commands()
    # The operator ends the outage from the website while the adapter is still unplugged.
    rig.c.post("/api/scenarios/clear")
    assert all(c["params"].get("source") != "adapter" for c in rig.run_commands())
    assert rig.source == "powerbank"
