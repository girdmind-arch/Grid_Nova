#!/usr/bin/env python3
"""A pretend ESP32 for trying the hardware demo without any hardware.

!! Every number this prints is SYNTHETIC. It exists to exercise the device contract (README, "Device
!! API") against a LOCAL backend. Never point it at the production site, and never present its values as
!! measurements.

It behaves like the recommended build (hardware/README.md): one INA219 after the relay, the adapter-sense
divider, three LED branches (critical, hostel, library), local automatic transfer while armed.

    GRIDNOVA_DEVICE_KEYS=esp32-demo-01:<24+ chars> uvicorn gridnova.main:app      # in backend/
    GRIDNOVA_URL=http://127.0.0.1:8000 DEVICE_ID=esp32-demo-01 DEVICE_KEY=<same key> python hardware/tools/mock_device.py

While it runs, type a letter and Enter to "touch" the pretend rig:
    u  unplug the wall adapter        p  plug it back in
    s  power bank goes to sleep       w  wake it
    e  press the emergency-stop button

Or script a demo: UNPLUG_AT=20 REPLUG_AT=80 (seconds after start). Standard library only.
"""

import json
import os
import random
import select
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("GRIDNOVA_URL", "http://127.0.0.1:8000").rstrip("/")
DEVICE_ID = os.environ.get("DEVICE_ID", "esp32-demo-01")
KEY = os.environ.get("DEVICE_KEY", "")
PERIOD_S = float(os.environ.get("PERIOD_S", "2"))
UNPLUG_AT = float(os.environ.get("UNPLUG_AT", "0") or 0)
REPLUG_AT = float(os.environ.get("REPLUG_AT", "0") or 0)

if not KEY:
    sys.exit("Set DEVICE_KEY to the key you put in GRIDNOVA_DEVICE_KEYS on the local backend.")
if urllib.parse.urlparse(BASE).hostname not in ("127.0.0.1", "localhost", "::1"):
    sys.exit("Refusing to run the mock against a remote site. Use a local backend.")

LOADS = ["critical", "hostel", "library"]
BRANCH_A = {"critical": 0.019, "hostel": 0.017, "library": 0.018}  # synthetic LED module currents
state = {"source": "adapter", "loads": {k: True for k in LOADS}, "estop": False,
         "adapter": True, "bank_awake": True, "armed": False, "auto": False}
boot, seq = uuid.uuid4().hex[:12], 0


def call(method, path, body=None):
    req = urllib.request.Request(
        BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "X-Device-Id": DEVICE_ID, "Authorization": f"Bearer {KEY}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def supplied() -> bool:
    return state["adapter"] if state["source"] == "adapter" else state["bank_awake"]


def telemetry():
    global seq
    seq += 1
    on = supplied()
    amps = 0.0012 + sum(BRANCH_A[k] for k, v in state["loads"].items() if v) if on else 0.0
    sense = 5.08 if state["adapter"] else 0.03
    return {
        "deviceId": DEVICE_ID, "bootId": boot, "seq": seq, "ts": time.time(), "firmware": "mock-0.2",
        "source": state["source"],
        "output": {"voltageV": round(5.04 + random.uniform(-0.02, 0.02), 3) if on else 0.01, "currentA": round(amps * random.uniform(0.98, 1.02), 4)},
        "adapterPresent": sense >= 4.3, "adapterSenseV": sense,
        "loads": dict(state["loads"]),
        "health": {"ina219Output": "ok", "adapterSense": "ok", "muxInterlock": "ok"}, "estop": state["estop"],
    }


def execute(cmd):
    """Returns (result, reason). Mirrors the firmware: validate everything, trust nothing."""
    if cmd["expiresAtEpoch"] < time.time():
        return "rejected", "expired before it was run"
    t, p = cmd["type"], cmd.get("params", {})
    if t == "estop":
        state["estop"] = True
        state["loads"] = {k: False for k in LOADS}
        return "applied", None
    if t == "clear_estop":
        state["estop"] = False  # loads stay off until commanded
        return "applied", None
    if state["estop"]:
        return "rejected", "emergency stop is latched"
    if not state["armed"]:
        return "rejected", "server says not armed"
    if t == "select_source" and p.get("source") in ("adapter", "powerbank"):
        if p["source"] == "adapter" and not state["adapter"]:
            return "rejected", "the adapter sense reads no voltage"
        state["source"] = p["source"]  # a changeover relay is break-before-make by construction
        return "applied", None
    if t == "set_load" and p.get("load") in LOADS and isinstance(p.get("on"), bool):
        if p["load"] == "critical" and not p["on"]:
            return "rejected", "the critical branch is never switched off"
        state["loads"][p["load"]] = p["on"]
        return "applied", None
    return "rejected", "not on the allow-list"


def control(body):
    c = (body or {}).get("control") or {}
    state["armed"], state["auto"] = bool(c.get("armed")), bool(c.get("autoTransfer"))
    if c.get("estop") and not state["estop"]:
        state["estop"], state["loads"] = True, {k: False for k in LOADS}


def touch(key):
    if key == "u":
        state["adapter"] = False
        print("  [you] unplugged the wall adapter")
    elif key == "p":
        state["adapter"] = True
        print("  [you] plugged the wall adapter back in")
    elif key == "s":
        state["bank_awake"] = False
        print("  [you] the power bank went to sleep")
    elif key == "w":
        state["bank_awake"] = True
        print("  [you] woke the power bank")
    elif key == "e":
        state["estop"], state["loads"] = True, {k: False for k in LOADS}
        print("  [you] pressed the emergency stop")


def main():
    print(f"MOCK device {DEVICE_ID} -> {BASE} (synthetic values). Keys: u/p adapter, s/w power bank, e e-stop.")
    start = time.time()
    while True:
        # keyboard (when run in a terminal) and scripted demo steps
        if sys.stdin and sys.stdin.isatty() and select.select([sys.stdin], [], [], 0)[0]:
            touch(sys.stdin.readline().strip().lower()[:1])
        t = time.time() - start
        if UNPLUG_AT and t >= UNPLUG_AT and state["adapter"] and not state.get("unplugged_once"):
            state["unplugged_once"] = True
            touch("u")
        if REPLUG_AT and t >= REPLUG_AT and not state["adapter"]:
            touch("p")
        # local automatic transfer, like the firmware (armed only)
        if state["auto"] and state["armed"] and not state["estop"] and state["source"] == "adapter" and not state["adapter"]:
            state["source"] = "powerbank"
            print("  [rig] automatic transfer to the power bank")
        code, body = call("POST", "/api/hardware/device/telemetry", telemetry())
        if code != 200:
            print("telemetry:", code, body)
        else:
            control(body)
            code, body = call("GET", "/api/hardware/device/commands")
            if code == 200:
                control(body)
            for cmd in body.get("commands", []) if code == 200 else []:
                result, reason = execute(cmd)
                ack = {"deviceId": DEVICE_ID, "result": result, "reason": reason, "ts": time.time(), "source": state["source"], "loads": state["loads"]}
                print(cmd["type"], cmd.get("params"), "->", result, reason or "", call("POST", f"/api/hardware/device/commands/{cmd['id']}/ack", ack)[0])
        time.sleep(PERIOD_S)


if __name__ == "__main__":
    main()
