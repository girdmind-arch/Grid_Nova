"""Hardware demo: every test talks to a mocked device. Nothing here touches a real rig or the live site."""

import copy

import pytest
from fastapi.testclient import TestClient

from gridnova import hardware as hw
from gridnova.main import app, grid_state

KEY = "k3y-for-tests-only-0123456789abcdef"
DEV = "esp32-test-01"
T0 = 1_790_000_000.0


class Rig:
    """A fake ESP32: advances a fake clock and posts well-formed (or deliberately broken) payloads."""

    def __init__(self, client):
        self.c, self.now, self.seq = client, T0, 0
        self.h = {"X-Device-Id": DEV, "Authorization": f"Bearer {KEY}"}

    def tel(self, **over):
        self.seq += 1
        body = {
            "deviceId": DEV, "bootId": "boot1", "seq": self.seq, "ts": self.now, "firmware": "0.1.0", "source": "adapter",
            "adapter": {"voltageV": 5.02, "currentA": 0.40}, "battery": {"voltageV": 5.10, "currentA": 0.0},
            "loads": {"critical": True, "hostel": True, "library": True, "extra": False},
            "health": {"ina219Adapter": "ok", "ina219Battery": "ok", "muxInterlock": "ok"}, "estop": False, "uptimeS": 100,
        }
        body.update(over)
        return body

    def send(self, **over):
        return self.c.post("/api/hardware/device/telemetry", json=self.tel(**over), headers=self.h)

    def tick(self, seconds, send=True, **over):
        self.now += seconds
        return self.send(**over) if send else None

    def commands(self):
        return self.c.get("/api/hardware/device/commands", headers=self.h).json()["commands"]

    def ack(self, cid, result="applied", **extra):
        body = {"deviceId": DEV, "result": result, "ts": self.now, **extra}
        return self.c.post(f"/api/hardware/device/commands/{cid}/ack", json=body, headers=self.h)

    def state(self):
        return self.c.get("/api/hardware/state").json()

    def state_with(self, headers):
        return self.c.get("/api/hardware/state", headers=headers).json()

    def go_hardware(self):
        assert self.c.post("/api/hardware/mode", json={"mode": "hardware-demo"}).status_code == 200

    def arm(self):
        assert self.send().status_code == 200
        self.go_hardware()
        r = self.c.post("/api/hardware/arm", json={"minutes": 5})
        assert r.status_code == 200, r.text
        return r.json()


@pytest.fixture()
def rig(monkeypatch):
    clock = {"t": T0}
    hw.service.reset()
    hw.service.configure(f"{DEV}:{KEY}")
    monkeypatch.setattr(hw.service, "clock", lambda: clock["t"])
    with TestClient(app) as client:
        client.post("/api/scenarios/clear")
        client.post("/api/control/mode", json={"mode": "ai"})
        r = Rig(client)
        # keep the rig's clock and the service's clock the same object
        type(r).now = property(lambda s: clock["t"], lambda s, v: clock.__setitem__("t", v))
        yield r
    hw.service.reset()
    hw.service.configure("")


def pop_set(d, *keys):
    return {k: v for k, v in d.items() if k not in keys}


# ------------------------------------------------------------------ authentication
def test_device_endpoints_need_the_device_key(rig):
    c = rig.c
    bad_headers = [{}, {"X-Device-Id": DEV, "Authorization": "Bearer wrong-key-wrong-key-wrong-key"},
                   {"X-Device-Id": "someone-else", "Authorization": f"Bearer {KEY}"}, {"Authorization": f"Bearer {KEY}"}]
    for call in (lambda h: c.get("/api/hardware/device/commands", headers=h), lambda h: c.get("/api/hardware/device/status", headers=h),
                 lambda h: c.post("/api/hardware/device/telemetry", json=rig.tel(), headers=h)):
        for h in bad_headers:
            assert call(h).status_code == 401
            rig.now += 61  # stay clear of the lock-out tested below
    assert c.get("/api/hardware/device/status", headers=rig.h).status_code == 200


def test_device_lockout_after_repeated_failures(rig):
    bad = {"X-Device-Id": DEV, "Authorization": "Bearer nope"}
    codes = [rig.c.get("/api/hardware/device/status", headers=bad).status_code for _ in range(12)]
    assert codes[:10] == [401] * 10 and codes[-1] == 429
    assert rig.c.get("/api/hardware/device/status", headers=rig.h).status_code == 429  # blocked even with the right key for a minute
    rig.now += 61
    assert rig.c.get("/api/hardware/device/status", headers=rig.h).status_code == 200


def test_no_keys_configured_means_no_hardware(rig):
    hw.service.configure("")
    assert rig.c.get("/api/hardware/device/status", headers=rig.h).status_code == 503
    r = rig.c.post("/api/hardware/mode", json={"mode": "hardware-demo"})
    assert r.status_code == 409  # cannot enter hardware mode without a configured device
    assert rig.state()["mode"] == "simulation"


def test_short_keys_are_ignored():
    svc = hw.HardwareService()
    svc.configure("esp32-a:short,esp32-b:" + "x" * 24 + ",BAD ID:" + "y" * 30)
    assert list(svc.keys) == ["esp32-b"]


def test_operator_routes_are_role_gated_but_the_device_needs_no_user(rig, monkeypatch):
    from gridnova import auth

    monkeypatch.setenv("GRIDNOVA_AUTH", "on")
    monkeypatch.setenv("GRIDNOVA_USERS", "asha:pw-op:operator,guest:pw-view:viewer")
    auth.reload_users()
    try:
        c = rig.c
        tok = lambda u, p: {"Authorization": "Bearer " + c.post("/api/auth/login", json={"username": u, "password": p}).json()["token"]}
        op, vw = tok("asha", "pw-op"), tok("guest", "pw-view")
        assert c.get("/api/hardware/state").status_code == 401
        assert c.get("/api/hardware/state", headers=vw).status_code == 200
        assert c.post("/api/hardware/mode", json={"mode": "hardware-demo"}, headers=vw).status_code == 403
        assert c.post("/api/hardware/estop", headers=vw).status_code == 403
        assert rig.send().status_code == 200  # the ESP32 uses its own key
        assert c.post("/api/hardware/mode", json={"mode": "hardware-demo"}, headers=op).status_code == 200
        assert c.post("/api/hardware/arm", json={"minutes": 5}, headers=op).json()["armedBy"] == "asha"
    finally:
        monkeypatch.undo()
        auth.reload_users()


def test_public_demo_accounts_cannot_move_a_rig(rig, monkeypatch):
    from gridnova import auth

    monkeypatch.setenv("GRIDNOVA_AUTH", "on")
    monkeypatch.delenv("GRIDNOVA_USERS", raising=False)
    auth.reload_users()  # demo accounts: their passwords are shown on the sign-in page
    try:
        tok = rig.c.post("/api/auth/login", json={"username": "operator", "password": "gridnova-operator"}).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}
        assert rig.c.post("/api/hardware/mode", json={"mode": "hardware-demo"}, headers=h).status_code == 409
        assert rig.c.post("/api/hardware/arm", json={"minutes": 5}, headers=h).status_code == 409
        assert rig.c.post("/api/hardware/estop", headers=h).status_code == 200  # stopping is always allowed
        assert rig.state_with(h)["mode"] == "simulation"
    finally:
        monkeypatch.undo()
        auth.reload_users()


# ------------------------------------------------------------------ telemetry validation
@pytest.mark.parametrize(
    "over,code",
    [
        ({"ts": T0 - 120}, 422),  # stale
        ({"ts": T0 + 120}, 422),  # clock in the future
        ({"adapter": {"voltageV": 12.0, "currentA": 0.1}}, 422),  # not a 5 V rig
        ({"adapter": {"voltageV": 5.0, "currentA": 4.5}}, 422),  # beyond the INA219 range
        ({"adapter": {"voltageV": 5.0, "currentA": -2.0}}, 422),
        ({"adapter": {"voltageV": 5.9, "currentA": 2.9}}, 422),  # 17 W: implausible for USB
        ({"adapter": {"voltageV": 5.0, "currentA": 0.1}, "health": {"ina219Adapter": "fault", "ina219Battery": "ok"}}, 422),
        ({"adapter": None}, 422),  # healthy sensor, no value
        ({"loads": {"critical": True, "gpio13": True}}, 422),  # unknown branch
        ({"socPct": 80}, 422),  # no invented state of charge
        ({"deviceId": "esp32-other"}, 403),
        ({"source": "mains"}, 422),
    ],
)
def test_bad_telemetry_is_rejected_and_never_shown(rig, over, code):
    assert rig.send().status_code == 200
    before = rig.state()["device"]["readings"]
    r = rig.send(**over)
    assert r.status_code == code, r.text
    assert rig.state()["device"]["readings"] == before


def test_repeated_or_replayed_sequence_numbers_are_refused(rig):
    first = rig.tel()
    assert rig.c.post("/api/hardware/device/telemetry", json=first, headers=rig.h).status_code == 200
    assert rig.c.post("/api/hardware/device/telemetry", json=first, headers=rig.h).status_code == 409
    assert rig.send(seq=0, bootId="boot2").status_code == 200  # a reboot starts a new sequence


def test_unhealthy_sensor_shows_no_value_and_a_warning(rig):
    r = rig.send(battery=None, health={"ina219Adapter": "ok", "ina219Battery": "missing", "muxInterlock": "ok"})
    assert r.status_code == 200
    dev = rig.state()["device"]
    assert dev["readings"]["battery"] is None and dev["readings"]["adapter"]["kind"] == "measured"
    assert any("battery-side sensor is missing" in w for w in dev["warnings"])


def test_readings_are_labelled_and_soc_stays_unknown(rig):
    rig.send()
    s = rig.state()
    a = s["device"]["readings"]["adapter"]
    assert a["voltageV"] == 5.02 and a["currentA"] == 0.4 and a["powerW"] == round(5.02 * 0.4, 3)
    assert a["kind"] == "measured" and "computed" in a["powerKind"]
    assert s["scale"] == "tabletop-usb" and s["notCampusPower"] is True
    assert s["device"]["stateOfCharge"]["socPct"] is None and s["device"]["stateOfCharge"]["status"] == "unknown"
    # a power bank at 5.1 V says nothing about charge: no percentage is ever derived
    assert "%" not in str(s["device"]["readings"])


# ------------------------------------------------------------------ online / offline / fail-safe
def test_device_goes_offline_and_arming_drops(rig):
    rig.arm()
    c, _ = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}), None
    assert c.status_code == 200
    assert rig.state()["device"]["status"] == "online"
    rig.now += 20  # no telemetry
    s = rig.state()
    assert s["device"]["status"] == "offline" and s["armed"] is False
    assert all(cmd["status"] in ("cancelled", "expired") for cmd in s["commands"])
    assert s["device"]["readings"]["adapter"]["fresh"] is False  # last known value, flagged stale
    assert rig.c.post("/api/hardware/arm", json={"minutes": 5}).status_code == 409
    assert rig.commands() == []  # nothing is handed out while disarmed


def test_never_seen_device_cannot_be_armed(rig):
    rig.go_hardware()
    assert rig.state()["device"]["status"] == "never_seen"
    assert rig.c.post("/api/hardware/arm", json={"minutes": 5}).status_code == 409


def test_arming_needs_hardware_mode_and_expires(rig):
    rig.send()
    assert rig.c.post("/api/hardware/arm", json={"minutes": 5}).status_code == 409  # still simulation
    rig.arm()
    for _ in range(7):
        rig.tick(50)  # keep the device alive, let the 5 minutes run out
    assert rig.state()["armed"] is False
    assert rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).status_code == 409


def test_leaving_hardware_mode_disarms_and_cancels(rig):
    rig.arm()
    cid = rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "powerbank"}).json()["command"]["id"]
    rig.c.post("/api/hardware/mode", json={"mode": "simulation"})
    s = rig.state()
    assert s["armed"] is False and s["mode"] == "simulation"
    assert next(c for c in s["commands"] if c["id"] == cid)["status"] == "cancelled"
    assert rig.commands() == []


# ------------------------------------------------------------------ command allow-list, expiry, ack
def test_nothing_can_be_commanded_while_disarmed(rig):
    rig.send()
    rig.go_hardware()
    r = rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "powerbank"})
    assert r.status_code == 409 and "armed" in r.json()["detail"].lower()


@pytest.mark.parametrize(
    "body",
    [
        {"type": "gpio_write", "pin": 13, "value": 1},
        {"type": "shell", "cmd": "reboot"},
        {"type": "select_source", "source": "mains"},
        {"type": "select_source"},
        {"type": "set_load", "load": "gpio13", "on": True},
        {"type": "set_load", "load": "extra"},
        {"type": "set_load", "load": "extra", "on": True, "pin": 5},  # extra field
        {"type": "estop"},  # only via the emergency-stop button
        {"type": "set_load", "load": "extra", "on": True, "ttlS": 3600},
    ],
)
def test_command_allow_list(rig, body):
    rig.arm()
    assert rig.c.post("/api/hardware/commands", json=body).status_code == 422
    assert rig.state()["commands"] == []


def test_critical_branch_cannot_be_switched_off(rig):
    rig.arm()
    assert rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "critical", "on": False}).status_code == 422
    assert rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "critical", "on": True}).status_code == 200


def test_command_lifecycle_ack_and_physical_confirmation(rig):
    rig.arm()
    sent = rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "powerbank"}).json()["command"]
    cid = sent["id"]
    assert sent["status"] == "queued" and sent["physicallyPerformed"] is False
    got = rig.commands()
    assert [(g["id"], g["type"], g["params"]) for g in got] == [(cid, "select_source", {"source": "powerbank"})]
    assert rig.c.get("/api/hardware/device/commands", headers=rig.h).json()["commands"][0]["id"] == cid  # re-polled until acked

    assert rig.ack(cid, source="powerbank").status_code == 200
    cmd = next(c for c in rig.state()["commands"] if c["id"] == cid)
    assert cmd["status"] == "applied" and cmd["physicallyPerformed"] is False  # told us, not yet seen in the readings
    rig.tick(1, source="powerbank", adapter={"voltageV": 5.0, "currentA": 0.0}, battery={"voltageV": 5.1, "currentA": 0.4})
    cmd = next(c for c in rig.state()["commands"] if c["id"] == cid)
    assert cmd["verified"] is True and cmd["physicallyPerformed"] is True

    again = rig.ack(cid).json()
    assert again["duplicate"] is True and again["status"] == "applied"


def test_acknowledged_but_never_seen_is_flagged_not_trusted(rig):
    rig.arm()
    cid = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).json()["command"]["id"]
    rig.commands()
    rig.ack(cid)
    rig.tick(12)  # telemetry still says extra=false
    cmd = next(c for c in rig.state()["commands"] if c["id"] == cid)
    assert cmd["status"] == "applied" and cmd["verified"] is False and cmd["physicallyPerformed"] is False


def test_rejected_by_the_device_is_recorded(rig):
    rig.arm()
    cid = rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "powerbank"}).json()["command"]["id"]
    rig.commands()
    assert rig.ack(cid, "rejected", reason="interlock fault").status_code == 200
    cmd = next(c for c in rig.state()["commands"] if c["id"] == cid)
    assert cmd["status"] == "rejected" and cmd["reason"] == "interlock fault" and cmd["physicallyPerformed"] is False


def test_duplicates_are_merged(rig):
    rig.arm()
    a = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).json()
    b = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).json()
    k1 = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "library", "on": False, "idempotencyKey": "tap-1"}).json()
    k2 = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "hostel", "on": False, "idempotencyKey": "tap-1"}).json()
    assert b["duplicate"] is True and b["command"]["id"] == a["command"]["id"]
    assert k2["duplicate"] is True and k2["command"]["id"] == k1["command"]["id"]
    assert len(rig.state()["commands"]) == 2


def test_source_switch_cooldown_and_queue_limit(rig):
    rig.arm()
    cid = rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "powerbank"}).json()["command"]["id"]
    rig.commands()
    rig.ack(cid, source="powerbank")
    rig.tick(1, source="powerbank", battery={"voltageV": 5.1, "currentA": 0.4}, adapter={"voltageV": 5.0, "currentA": 0.0})
    too_soon = rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "adapter"})
    assert too_soon.status_code == 429
    rig.tick(6, source="powerbank", battery={"voltageV": 5.1, "currentA": 0.4}, adapter={"voltageV": 5.0, "currentA": 0.0})
    assert rig.c.post("/api/hardware/commands", json={"type": "select_source", "source": "adapter"}).status_code == 200


def test_commands_expire_and_a_late_ack_is_marked(rig):
    rig.arm()
    cid = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True, "ttlS": 5}).json()["command"]["id"]
    rig.tick(8)  # device alive, command not fetched in time
    assert rig.commands() == []
    cmd = next(c for c in rig.state()["commands"] if c["id"] == cid)
    assert cmd["status"] == "expired"
    assert rig.ack(cid).status_code == 200  # a device that still applied it must say so
    cmd = next(c for c in rig.state()["commands"] if c["id"] == cid)
    assert cmd["late"] is True and any("after it expired" in e["text"] for e in rig.state()["events"])


def test_ack_edge_cases(rig):
    rig.arm()
    assert rig.ack("cmd-000000000000").status_code == 404
    assert rig.ack("not-a-command-id").status_code == 422
    cid = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).json()["command"]["id"]
    assert rig.ack(cid).status_code == 409  # never delivered
    rig.commands()
    assert rig.c.post(f"/api/hardware/device/commands/{cid}/ack", json={"deviceId": DEV, "result": "applied", "ts": rig.now - 500}, headers=rig.h).status_code == 422
    assert rig.c.post(f"/api/hardware/device/commands/{cid}/ack", json={"deviceId": "esp32-other", "result": "applied", "ts": rig.now}, headers=rig.h).status_code == 403
    assert rig.c.post(f"/api/hardware/device/commands/{cid}/ack", json={"deviceId": DEV, "result": "maybe", "ts": rig.now}, headers=rig.h).status_code == 422


def test_delivery_is_gated_on_arming_even_if_a_command_slipped_through(rig):
    rig.arm()
    rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True})
    hw.service.armed_until = None  # simulate a bug that left a command queued while disarmed
    assert rig.commands() == []


def test_disarm_cancels_waiting_commands(rig):
    rig.arm()
    cid = rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).json()["command"]["id"]
    rig.c.post("/api/hardware/disarm")
    assert next(c for c in rig.state()["commands"] if c["id"] == cid)["status"] == "cancelled"
    assert rig.commands() == []


# ------------------------------------------------------------------ emergency stop and the interlock
def test_emergency_stop_and_reset(rig):
    rig.arm()
    assert rig.c.post("/api/hardware/estop").status_code == 200
    s = rig.state()
    assert s["estop"]["active"] and s["armed"] is False
    cmds = rig.commands()  # delivered even though disarmed: stopping must always get through
    assert [c["type"] for c in cmds] == ["estop"]
    assert rig.c.get("/api/hardware/device/status", headers=rig.h).json()["control"]["estop"] is True
    rig.ack(cmds[0]["id"])
    assert rig.c.post("/api/hardware/arm", json={"minutes": 5}).status_code == 409
    assert rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True}).status_code == 409

    assert rig.c.post("/api/hardware/estop/reset").status_code == 200
    assert [c["type"] for c in rig.commands()] == ["clear_estop"]
    s = rig.state()
    assert s["estop"]["active"] is False and s["estop"]["resetPending"] is True and s["armed"] is False
    rig.tick(1, estop=False)
    assert rig.state()["estop"]["resetPending"] is False
    assert rig.c.post("/api/hardware/estop/reset").status_code == 409  # nothing to reset


def test_a_device_side_emergency_stop_latches_the_server(rig):
    rig.arm()
    rig.tick(1, estop=True, loads={"critical": False, "hostel": False, "library": False, "extra": False})
    s = rig.state()
    assert s["estop"]["active"] and "device reported" in s["estop"]["reason"] and s["armed"] is False


def test_parallel_source_interlock_trips_the_emergency_stop(rig):
    rig.arm()
    rig.tick(5, battery={"voltageV": 5.1, "currentA": 0.6})  # adapter selected but the power bank is also delivering
    s = rig.state()
    assert s["estop"]["active"] and "parallel" in s["estop"]["reason"] and s["armed"] is False


def test_interlock_only_warns_when_not_armed(rig):
    rig.send(battery={"voltageV": 5.1, "currentA": 0.6})
    s = rig.state()
    assert not s["estop"]["active"] and any("parallel" in w for w in s["device"]["warnings"])


# ------------------------------------------------------------------ capability map and scenario routing
def test_capability_map_is_honest(rig):
    caps = rig.c.get("/api/hardware/capabilities").json()
    s = caps["scenarios"]
    assert s["grid_outage"]["hardware"] == "supported" and s["grid_outage"]["approval"] is True
    assert s["heatwave"]["hardware"] == "approximation" and "pwm brightness" in s["heatwave"]["summary"].lower()
    assert s["line_failure"]["hardware"] == "approximation"
    assert s["cloud_cover"]["hardware"] == "approximation" and "no solar panel" in s["cloud_cover"]["summary"].lower()
    assert caps["commands"] == ["select_source", "set_load", "set_brightness"] and caps["stateOfCharge"] == "unknown"
    assert {"name": "critical", "essential": True} in caps["loads"]


def inject(rig, kind, severity=3):
    return rig.c.post("/api/scenarios/inject", json={"type": kind, "severity": severity, "durationMin": 30}).json()


@pytest.mark.parametrize("kind", ["cloud_cover", "heatwave", "line_failure", "grid_outage"])
def test_scenarios_stay_in_the_simulation_unless_armed(rig, kind):
    res = inject(rig, kind)
    assert res["hardware"]["outcome"] == "simulated_only" and res["hardware"]["physicallyPerformed"] is False
    assert res["hardware"]["dataSource"] == "simulation"
    rig.send()
    rig.go_hardware()  # hardware mode but NOT armed
    res = inject(rig, kind)
    assert res["hardware"]["physicallyPerformed"] is False and res["hardware"]["commandIds"] == []
    if kind in ("heatwave", "grid_outage"):
        assert res["hardware"]["outcome"] == "simulated_only" and "not armed" in res["hardware"]["reason"]
    assert rig.state()["commands"] == []
    assert rig.commands() == []


def test_cloud_cover_uses_visual_pwm_approximation(rig):
    rig.arm()
    cc = inject(rig, "cloud_cover", 5)["hardware"]
    assert cc["outcome"] == "hardware_pending" and "no solar panel" in cc["reason"].lower()
    cloud_cmds = rig.commands()
    assert len(cloud_cmds) == 3 and all(c["type"] == "set_brightness" for c in cloud_cmds)
    assert {c["params"]["level"] for c in cloud_cmds} == {35}


def test_line_failure_uses_target_zone_visual_pwm(rig):
    rig.arm()
    lf = inject(rig, "line_failure", 3)["hardware"]
    assert lf["outcome"] == "hardware_pending" and lf["commandIds"]
    line_cmds = rig.commands()
    assert [(c["type"], c["params"]) for c in line_cmds] == [("set_brightness", {"load": "hostel", "level": 32})]
    assert "solar" not in str(rig.state()["device"]["readings"]).lower()  # nothing solar is ever invented


def test_heatwave_changes_led_brightness_and_restores_on_clear(rig):
    rig.arm()
    rig.tick(1, loads={"critical": True, "hostel": False, "library": False, "extra": False})
    res = inject(rig, "heatwave", 3)["hardware"]
    assert res["outcome"] == "hardware_pending" and "not cooling" in res["reason"].lower()
    got = rig.commands()
    assert [(c["type"], c["params"]) for c in got] == [
        ("set_brightness", {"load": "extra", "level": 187}),
        ("set_brightness", {"load": "library", "level": 187}),
    ]
    for c in got:
        rig.ack(c["id"])
    rig.tick(1, loads={"critical": True, "hostel": False, "library": True, "extra": True})
    rig.c.post("/api/scenarios/clear")
    back = rig.commands()
    assert sorted((c["params"]["load"], c["params"]["level"]) for c in back) == [("extra", 0), ("library", 0)]


def test_pwm_command_is_validated_and_verified_by_telemetry(rig):
    rig.arm()
    bad = rig.c.post("/api/hardware/commands", json={"type": "set_brightness", "load": "critical", "level": 0})
    assert bad.status_code == 422
    command = rig.c.post("/api/hardware/commands", json={"type": "set_brightness", "load": "hostel", "level": 128})
    assert command.status_code == 200
    queued = rig.commands()[0]
    assert queued["type"] == "set_brightness" and queued["params"] == {"load": "hostel", "level": 128}
    ack = rig.ack(queued["id"], loads={"critical": True, "hostel": True, "library": True, "extra": False},
                  brightness={"critical": 255, "hostel": 128, "library": 255, "extra": 0})
    assert ack.status_code == 200
    assert rig.send(loads={"critical": True, "hostel": True, "library": True, "extra": False},
                    brightness={"critical": 255, "hostel": 128, "library": 255, "extra": 0}).status_code == 200
    done = next(c for c in rig.state()["commands"] if c["id"] == queued["id"])
    assert done["physicallyPerformed"] is True


def test_outage_waits_for_the_same_approval_as_the_simulation(rig):
    rig.arm()
    rig.tick(1, loads={"critical": True, "hostel": True, "library": True, "extra": True})
    res = inject(rig, "grid_outage", 4)["hardware"]
    assert res["outcome"] == "awaiting_approval" and len(res["commandIds"]) == 3
    assert {c["status"] for c in rig.state()["commands"]} == {"awaiting_approval"}
    assert rig.commands() == []  # nothing is deliverable before a human decides

    d = rig.c.post("/api/agents/orchestrator/step").json()
    assert d["approval"]["status"] == "pending"
    assert rig.commands() == []
    done = rig.c.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "approve"}).json()
    assert done["hardware"]["outcome"] == "hardware_pending"
    got = rig.commands()
    assert [(c["type"], c["params"]) for c in got] == [
        ("select_source", {"source": "powerbank"}), ("set_load", {"load": "extra", "on": False}), ("set_load", {"load": "library", "on": False})]
    assert all(c["params"].get("load") != "critical" for c in got)  # the critical branch is never shed


def test_rejecting_the_outage_plan_sends_nothing(rig):
    rig.arm()
    inject(rig, "grid_outage", 3)
    d = rig.c.post("/api/agents/orchestrator/step").json()
    done = rig.c.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "reject"}).json()
    assert done["hardware"]["outcome"] == "simulated_only" and "rejected" in done["hardware"]["reason"].lower()
    assert rig.commands() == [] and {c["status"] for c in rig.state()["commands"]} == {"cancelled"}


def test_approval_after_disarm_does_not_move_the_rig(rig):
    rig.arm()
    inject(rig, "grid_outage", 3)
    d = rig.c.post("/api/agents/orchestrator/step").json()
    rig.c.post("/api/hardware/disarm")
    done = rig.c.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "approve"}).json()
    assert done["approval"]["status"] == "approved"  # the simulation carries on
    assert rig.commands() == []
    assert done.get("hardware") is None or done["hardware"]["physicallyPerformed"] is False


def test_outage_restore_on_clear(rig):
    rig.arm()
    inject(rig, "grid_outage", 3)
    d = rig.c.post("/api/agents/orchestrator/step").json()
    rig.c.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "approve"})
    for c in rig.commands():
        rig.ack(c["id"])
    rig.tick(6, source="powerbank", battery={"voltageV": 5.1, "currentA": 0.4}, adapter={"voltageV": 5.0, "currentA": 0.0})
    rig.c.post("/api/scenarios/clear")
    kinds = [(c["type"], c["params"]) for c in rig.commands()]
    assert ("select_source", {"source": "adapter"}) in kinds


# ------------------------------------------------------------------ simulation stays the default and unchanged
OLD_GRID_KEYS = {"timestamp", "mode", "demandKw", "solarKw", "gridImportKw", "battery", "costTodayInr", "baselineCostTodayInr",
                 "tariff", "trends", "zones", "flows", "activeFault", "environment"}


def snap():
    for _ in range(3):  # the simulator advances in whole minutes; retry if one ticks over
        a, b = grid_state(), grid_state()
        if a["timestamp"] == b["timestamp"]:
            return a
    return b


def test_simulation_is_the_default(rig):
    s = rig.state()
    assert s["mode"] == "simulation" and s["armed"] is False and s["dataSource"] == "simulation"
    g = rig.c.get("/api/grid/state").json()
    assert g["dataSource"] == "simulation" and set(g) == OLD_GRID_KEYS | {"dataSource"}
    assert rig.c.get("/api/health").json()["hardware"] == {"mode": "simulation", "armed": False, "device": "never_seen", "estop": False}


def test_rig_readings_never_touch_the_campus_numbers(rig):
    before = copy.deepcopy(snap())
    rig.arm()
    rig.tick(1, adapter={"voltageV": 5.9, "currentA": 2.0}, battery={"voltageV": 5.0, "currentA": 0.0})
    rig.c.post("/api/hardware/commands", json={"type": "set_load", "load": "extra", "on": True})
    rig.c.post("/api/hardware/estop")
    after = snap()
    if after["timestamp"] == before["timestamp"]:
        assert after == before
    else:  # a simulator minute passed: every campus value is still on the campus scale and from the simulator
        assert after["dataSource"] == "simulation" and after["demandKw"] > 50 and 20 <= after["battery"]["socPct"] <= 90
    assert after["battery"]["capacityKwh"] > 100 and after["solarKw"] != 5.9


def test_scenario_flow_in_simulation_mode_is_unchanged(rig):
    for kind in ("cloud_cover", "heatwave", "line_failure"):
        rig.c.post("/api/scenarios/clear")
        res = inject(rig, kind)
        assert res["hardware"]["outcome"] in ("simulated_only",) and res["message"] == "Scenario started."
        d = rig.c.post("/api/agents/orchestrator/step").json()
        assert d["chosenPlanId"] in {"A", "B"} and [s["kind"] for s in d["steps"]] == ["observe", "reason", "plan", "safety", "act", "result"]
        assert "hardware" not in d
    rig.c.post("/api/scenarios/clear")
    inject(rig, "grid_outage")
    d = rig.c.post("/api/agents/orchestrator/step").json()
    assert d["approval"]["status"] == "pending"
    done = rig.c.post(f"/api/agents/decisions/{d['id']}/approval", json={"decision": "approve"}).json()
    assert done["approval"]["status"] == "approved" and "hardware" not in done
    assert rig.state()["commands"] == []


def test_a_hardware_failure_cannot_break_a_scenario(rig, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("rig exploded")

    monkeypatch.setattr(hw.service, "plan_for_scenario", boom)
    res = inject(rig, "heatwave")
    assert res["message"] == "Scenario started." and res["hardware"]["outcome"] == "simulated_only"
