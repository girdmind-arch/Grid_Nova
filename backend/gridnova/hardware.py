"""Hardware demo: a safe, low-voltage ESP32 tabletop rig next to the simulated campus.

The simulation stays the default and is NEVER fed by the rig. The rig has its own state, its own
labelled readings (volts and amps at USB level, not campus kW/kWh) and its own command queue.

    simulation      (default) nothing is sent to the rig. Telemetry is shown but not acted on.
    hardware-demo   the rig is visible and, only while an operator has ARMED it, scenario actions may
                    be turned into a short allow-listed set of commands for the device.

The device talks to us (outbound HTTPS polling), so nothing needs to be opened on the rig's network:

    POST /api/hardware/device/telemetry          device -> server  readings, source, loads, sensor health
    GET  /api/hardware/device/commands           device <- server  queued commands + control flags
    POST /api/hardware/device/commands/{id}/ack  device -> server  what it actually did
    GET  /api/hardware/device/status             device <- server  control flags only (cheap heartbeat)

Every device call carries `X-Device-Id` and `Authorization: Bearer <device key>`. Keys come from
GRIDNOVA_DEVICE_KEYS ("esp32-demo-01:<24+ char secret>", comma separated); there is no default key.

Safety model, summarised (the README has the long version):
  * strict allow-list: select_source (adapter | powerbank) and set_load (named LED branches) only,
    plus estop / clear_estop. No GPIO numbers, no shell, nothing free-form.
  * physical control needs an operator to ARM (time limited). Arming drops on expiry, device loss,
    emergency stop or leaving hardware mode, and queued commands are cancelled with it.
  * outage / load-shed scenario actions wait for the same human approval the simulator already asks for.
  * commands expire in seconds; duplicates are merged; the device acknowledges and the next telemetry
    must show the change before we say it was "physically performed".
  * the "critical" LED branch can never be commanded off, power-bank charge is always "unknown".
"""

from __future__ import annotations

import hmac
import logging
import math
import os
import re
import secrets
import threading
import time
from collections import deque

import numpy as np
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Literal

from pydantic import BaseModel, Field

log = logging.getLogger("gridnova.hardware")

# ---------------------------------------------------------------- the fixed vocabulary
MODES = ("simulation", "hardware-demo")
SOURCES = ("adapter", "powerbank")
LOADS = ("critical", "hostel", "library", "extra")  # named low-voltage LED branches
ESSENTIAL = frozenset({"critical"})  # never commanded off
SHED_ORDER = ("extra", "library", "hostel")  # first to go when shedding
ADD_ORDER = ("extra", "library", "hostel")  # first to come on to approximate more demand
COMMAND_TYPES = ("select_source", "set_load", "estop", "clear_estop")
SCENARIOS = ("cloud_cover", "heatwave", "line_failure", "grid_outage")

# ---------------------------------------------------------------- limits (tabletop, USB level)
MAX_VOLTS, MIN_AMPS, MAX_AMPS = 6.0, -0.1, 3.0  # INA219 on a 0.1 ohm shunt tops out at 3.2 A
MAX_WATTS = 15.0
MAX_SKEW_S = 30.0  # device clock vs ours (NTP on the ESP32 keeps this tiny)
FRESH_S = 10.0  # readings older than this are not used to take decisions
OFFLINE_AFTER_S = 15.0  # no accepted telemetry for this long = offline
ARM_DEFAULT_MIN, ARM_MAX_MIN = 10, 30
CMD_TTL_DEFAULT_S, CMD_TTL_MAX_S = 20, 60
MAX_ACTIVE_COMMANDS = 8
SOURCE_COOLDOWN_S = 5.0  # the power mux needs time to settle between switches
PARALLEL_AMPS = 0.25  # current on the NON-selected source = suspected parallel connection (two-sensor rigs)
# Single-sensor rigs (one INA219 after the relay, the recommended parts list):
ADAPTER_PRESENT_V = 4.3  # adapter sense (voltage divider on GPIO 34) at or above this = adapter plugged in
SUPPLY_LOST_V = 4.0  # bus voltage below this while a source is selected = that source is not supplying
LOST_READINGS, BACK_READINGS = 2, 3  # debounce: ~4 s to declare the adapter lost, ~6 s to trust it is back
KEEPALIVE_A = float(os.environ.get("GRIDNOVA_RIG_KEEPALIVE_A", "0.06"))  # many power banks sleep below ~50-100 mA
TRIP_A = float(os.environ.get("GRIDNOVA_RIG_TRIP_A", "1.0"))  # output current above this = fault: emergency stop
VERIFY_WITHIN_S = 10.0
AUTH_FAILS, AUTH_WINDOW_S = 10, 60.0

SOC_UNKNOWN = {
    "status": "unknown",
    "socPct": None,
    "reason": "A power bank's USB output voltage is regulated, so charge level cannot be read from it. Shown as unknown.",
}

CAPABILITIES = {
    "grid_outage": {
        "hardware": "supported",
        "approval": True,
        "summary": "Unplugging the rig's wall adapter starts this scenario by itself. The rig moves to the power bank at once when armed (automatic transfer); shedding non-essential LED branches waits for the operator's approval, and never goes below the power bank's keep-alive current. Plugging the adapter back in ends it.",
    },
    "heatwave": {
        "hardware": "approximation",
        "approval": False,
        "summary": "Approximates higher demand by switching on LED branches that are off. If every branch is already on there is nothing to add. This is not air conditioning or pre-cooling.",
    },
    "line_failure": {
        "hardware": "simulated_only",
        "approval": False,
        "summary": "Rerouting needs separately switched branches and a real alternate low-voltage path. This build has neither, so it runs in the simulation only.",
    },
    "cloud_cover": {
        "hardware": "software_only",
        "approval": False,
        "summary": "This build has no solar panel. The scenario is simulated; the hardware is not told about it and no solar readings are invented.",
    },
}

ACTIVE = ("awaiting_approval", "queued", "delivered")


class HWError(Exception):
    """A refusal with an HTTP status and a message that is safe to show to people."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


# ---------------------------------------------------------------- device payloads
_ID = r"^[a-z0-9][a-z0-9_-]{2,31}$"
Health = Literal["ok", "missing", "fault"]


class Reading(BaseModel, extra="forbid"):
    voltageV: float = Field(ge=0, le=MAX_VOLTS, allow_inf_nan=False)
    currentA: float = Field(ge=MIN_AMPS, le=MAX_AMPS, allow_inf_nan=False)


class SensorHealth(BaseModel, extra="forbid"):
    """Which sensors the rig has and whether each is answering. A sensor that is not fitted is left out (None).

    Recommended build: one INA219 on the switched output (ina219Output) plus the adapter-sense divider.
    Older two-sensor builds report ina219Adapter / ina219Battery instead.
    """

    ina219Adapter: Health | None = None
    ina219Battery: Health | None = None
    ina219Output: Health | None = None
    adapterSense: Health | None = None
    muxInterlock: Literal["ok", "fault"] = "ok"


class Telemetry(BaseModel, extra="forbid"):
    deviceId: str = Field(pattern=_ID)
    bootId: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    seq: int = Field(ge=0, le=2**31)
    ts: float = Field(gt=1.5e9, lt=4.2e9, allow_inf_nan=False)  # unix seconds, device clock (NTP)
    firmware: str = Field(min_length=1, max_length=32)
    source: Literal["adapter", "powerbank", "none"]
    adapter: Reading | None = None
    battery: Reading | None = None
    output: Reading | None = None  # INA219 after the relay: whatever source is selected
    adapterPresent: bool | None = None  # from the adapter-sense divider
    adapterSenseV: float | None = Field(None, ge=0, le=MAX_VOLTS, allow_inf_nan=False)
    loads: dict[str, bool]
    health: SensorHealth
    estop: bool = False
    uptimeS: int = Field(0, ge=0, le=2**31)


class Ack(BaseModel, extra="forbid"):
    deviceId: str = Field(pattern=_ID)
    result: Literal["applied", "rejected", "failed"]
    reason: str | None = Field(None, max_length=120)
    ts: float = Field(gt=1.5e9, lt=4.2e9, allow_inf_nan=False)
    source: Literal["adapter", "powerbank", "none"] | None = None
    loads: dict[str, bool] | None = None


class CommandBody(BaseModel, extra="forbid"):
    """What an operator may ask for by hand. Anything else is refused by the schema."""

    type: Literal["select_source", "set_load"]
    source: Literal["adapter", "powerbank"] | None = None
    load: Literal["critical", "hostel", "library", "extra"] | None = None
    on: bool | None = None
    ttlS: int = Field(CMD_TTL_DEFAULT_S, ge=5, le=CMD_TTL_MAX_S)
    idempotencyKey: str | None = Field(None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")


# ---------------------------------------------------------------- internals
@dataclass
class Command:
    id: str
    type: str
    params: dict
    origin: str  # operator | scenario | system
    created_at: float
    expires_at: float
    ttl_s: int
    status: str = "queued"
    incident_id: str | None = None
    idem: str | None = None
    delivered_at: float | None = None
    acked_at: float | None = None
    reason: str | None = None
    late: bool = False
    verified: bool | None = None
    note: str = ""

    def spec_key(self) -> tuple:
        return (self.type, tuple(sorted(self.params.items())))

    def to_json(self) -> dict:
        return {
            "id": self.id, "type": self.type, "params": self.params, "origin": self.origin, "status": self.status,
            "incidentId": self.incident_id, "createdAt": _iso(self.created_at), "expiresAt": _iso(self.expires_at),
            "deliveredAt": _iso(self.delivered_at), "ackedAt": _iso(self.acked_at), "reason": self.reason, "note": self.note,
            "verified": self.verified, "late": self.late,
            # "Done on the rig" means the device said so AND the next telemetry showed it.
            "physicallyPerformed": self.status == "applied" and self.verified is True,
        }


def _iso(t: float | None) -> str | None:
    return None if t is None else datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


@dataclass
class Scenario:
    incident_id: str
    type: str
    severity: int
    restore: list[dict] = field(default_factory=list)  # command specs that undo what we changed
    command_ids: list[str] = field(default_factory=list)
    awaiting_approval: bool = False
    restore_now: list[tuple] = field(default_factory=list)  # undoes what ran without approval (the transfer)


class RigModel:
    """What each LED branch actually draws, learned from the rig's own readings.

    A linear model, current = base + sum(branch on x branch current), fitted by ridge regression
    on every reading from the output sensor. It starts from a prior (~18 mA per 5 V LED module,
    ~1 mA for the sensor and relay coil feed) and moves to your hardware's real values as branches
    are switched. The Planner uses it to predict the current of a plan before sending it, e.g. to
    keep a power bank above its keep-alive current when shedding branches.
    """

    PRIOR_BASE_A, PRIOR_BRANCH_A, PRIOR_WEIGHT = 0.001, 0.018, 4.0

    def __init__(self, branches: tuple[str, ...] = ("critical", "hostel", "library")):
        self.branches = tuple(branches)
        n = len(self.branches) + 1
        self.xtx = np.eye(n) * self.PRIOR_WEIGHT
        prior = np.array([self.PRIOR_BASE_A] + [self.PRIOR_BRANCH_A] * (n - 1))
        self.xty = self.xtx @ prior
        self.samples = 0
        self.combos: set[tuple[bool, ...]] = set()
        self.coef = prior

    def observe(self, loads: dict[str, bool], current_a: float) -> None:
        if tuple(sorted(loads)) != tuple(sorted(self.branches)):
            self.__init__(tuple(n for n in LOADS if n in loads))
        x = np.array([1.0] + [1.0 if loads.get(b) else 0.0 for b in self.branches])
        decay = 0.995  # slowly forget, so a swapped LED module is relearned
        self.xtx = decay * self.xtx + np.outer(x, x)
        self.xty = decay * self.xty + x * current_a
        self.coef = np.linalg.solve(self.xtx, self.xty)
        self.samples += 1
        self.combos.add(tuple(bool(loads.get(b)) for b in self.branches))

    def predict(self, loads: dict[str, bool]) -> float:
        x = np.array([1.0] + [1.0 if loads.get(b) else 0.0 for b in self.branches])
        return float(max(0.0, x @ self.coef))

    def to_json(self) -> dict:
        return {
            "baseMa": round(float(self.coef[0]) * 1000, 1),
            "branchMa": {b: round(float(self.coef[i + 1]) * 1000, 1) for i, b in enumerate(self.branches)},
            "samples": self.samples,
            # Each branch's own current can only be told apart after the readings saw it both on and off.
            "confident": len(self.combos) > len(self.branches),
        }


class HardwareService:
    def __init__(self, clock: Callable[[], float] = time.time):
        self.clock = clock
        self._lock = threading.RLock()
        self.keys: dict[str, str] = {}
        self.configure_from_env()
        self.reset()

    # ------------------------------------------------------------ setup
    def configure_from_env(self) -> None:
        self.configure(os.environ.get("GRIDNOVA_DEVICE_KEYS", ""))

    def configure(self, raw_keys: str) -> None:
        keys: dict[str, str] = {}
        for item in raw_keys.split(","):
            did, _, key = item.strip().partition(":")
            if not did or not re.match(_ID, did):
                continue
            if len(key) < 24:
                if key:
                    log.warning("device key for %s ignored: use at least 24 characters", did)
                continue
            keys[did] = key
        self.keys = keys

    def reset(self) -> None:
        """Back to the safe default: simulation, disarmed, nothing queued, no device seen."""
        with self._lock:
            self.mode = "simulation"
            self.armed_until: float | None = None
            self.armed_by = ""
            self.estop = False
            self.estop_reason = ""
            self.estop_reset_pending = False
            self.tel: Telemetry | None = None
            self.last_rx: float | None = None
            self.boot_id = ""
            self.last_seq = -1
            self.warnings: list[str] = []
            self.commands: dict[str, Command] = {}
            self.scenario: Scenario | None = None
            self.last_source_cmd = 0.0
            self.events: deque[dict] = deque(maxlen=25)
            self._fails: dict[str, list[float]] = {}
            self.model = RigModel()
            # Physical events the agents act on (adapter unplugged / back, power bank asleep), oldest first.
            self.rig_events: deque[dict] = deque(maxlen=20)
            self.adapter_ok: bool | None = None  # debounced
            self._adapter_run = (None, 0)  # (last raw value, consecutive count)
            self._quiet = 0  # consecutive readings below the power bank's keep-alive current

    @property
    def configured(self) -> bool:
        return bool(self.keys)

    def _now(self) -> float:
        return self.clock()

    def _event(self, text: str, level: str = "info") -> None:
        self.events.appendleft({"at": _iso(self._now()), "level": level, "text": text})
        log.info("hardware: %s", text)

    # ------------------------------------------------------------ device authentication
    def authenticate_device(self, device_id: str | None, authorization: str | None, client: str = "") -> str:
        with self._lock:
            now = self._now()
            if not self.keys:
                raise HWError(503, "No hardware device is configured on this server.")
            recent = [t for t in self._fails.get(client, []) if now - t < AUTH_WINDOW_S]
            self._fails[client] = recent
            if len(recent) >= AUTH_FAILS:
                raise HWError(429, "Too many failed device sign-ins. Wait a minute.")
            token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else ""
            did = (device_id or "").strip().lower()
            expected = self.keys.get(did, "")
            # Compare even when the id is unknown, so timing does not reveal valid ids.
            ok = hmac.compare_digest(token.encode(), (expected or secrets.token_hex(16)).encode()) and bool(expected)
            if not ok:
                self._fails.setdefault(client, []).append(now)
                raise HWError(401, "Device not authorised.")
            self._fails.pop(client, None)
            return did

    # ------------------------------------------------------------ device state helpers
    def _age(self) -> float | None:
        return None if self.last_rx is None else self._now() - self.last_rx

    def device_status(self) -> str:
        age = self._age()
        return "never_seen" if age is None else "online" if age <= OFFLINE_AFTER_S else "offline"

    def _fresh(self) -> bool:
        age = self._age()
        return age is not None and age <= FRESH_S and self.tel is not None

    @property
    def armed(self) -> bool:
        return self.armed_until is not None and self._now() < self.armed_until and self.mode == "hardware-demo"

    # ------------------------------------------------------------ housekeeping (called on every request and by the agent loop)
    def housekeeping(self) -> None:
        with self._lock:
            now = self._now()
            for c in self.commands.values():
                if c.status in ("queued", "delivered") and now >= c.expires_at:
                    c.status, c.reason = "expired", c.reason or "Not acknowledged in time; the device will ignore it."
                    self._event(f"Command {c.id} ({c.type}) expired.", "warning")
                elif c.status == "awaiting_approval" and now >= c.expires_at + 300:
                    c.status, c.reason = "expired", "Approval did not arrive in time."
                if c.status == "applied" and c.verified is None and c.acked_at and now - c.acked_at > VERIFY_WITHIN_S:
                    c.verified = False
                    self._event(f"Command {c.id} was acknowledged but the readings never showed it.", "warning")
            if self.armed_until is not None:
                why = None
                if now >= self.armed_until:
                    why = "arming expired"
                elif self.mode != "hardware-demo":
                    why = "left hardware demo mode"
                elif self.device_status() != "online":
                    why = "the device went offline: back to simulation only"
                elif self.estop:
                    why = "emergency stop"
                if why:
                    self._disarm(why)
            # keep only the latest few finished commands
            if len(self.commands) > 60:
                for cid in [k for k, c in self.commands.items() if c.status not in ACTIVE][: len(self.commands) - 60]:
                    del self.commands[cid]

    def _cancel_active(self, why: str, keep: tuple[str, ...] = ()) -> None:
        for c in self.commands.values():
            if c.status in ACTIVE and c.type not in keep:
                c.status, c.reason = "cancelled", why

    def _disarm(self, why: str) -> None:
        self.armed_until, self.armed_by = None, ""
        self._cancel_active(f"Disarmed ({why}).", keep=("estop", "clear_estop"))
        self.scenario = None
        self._event(f"Hardware disarmed: {why}.", "warning")

    # ------------------------------------------------------------ telemetry
    def ingest_telemetry(self, t: Telemetry, device_id: str) -> dict:
        with self._lock:
            now = self._now()
            if t.deviceId != device_id:
                raise HWError(403, "deviceId does not match the signed-in device.")
            if set(t.loads) - set(LOADS):
                raise HWError(422, f"Unknown load branch. Allowed: {', '.join(LOADS)}.")
            if abs(now - t.ts) > MAX_SKEW_S:
                raise HWError(422, f"Reading rejected: device clock is {abs(now - t.ts):.0f} s from server time (limit {MAX_SKEW_S:.0f} s). Sync NTP.")
            for name, rd, hl in (("adapter", t.adapter, t.health.ina219Adapter), ("battery", t.battery, t.health.ina219Battery),
                                 ("output", t.output, t.health.ina219Output)):
                if hl is None:
                    if rd is not None:
                        raise HWError(422, f"An {name} reading was sent but no {name} sensor is listed in health.")
                    continue
                if rd is not None and hl != "ok":
                    raise HWError(422, f"The {name} sensor reports '{hl}' but sent a value. Send no reading when the sensor is not healthy.")
                if rd is None and hl == "ok":
                    raise HWError(422, f"The {name} sensor reports 'ok' but sent no reading.")
                if rd is not None and rd.voltageV * max(rd.currentA, 0) > MAX_WATTS:
                    raise HWError(422, f"The {name} reading is physically implausible for this rig (over {MAX_WATTS:.0f} W).")
            if t.adapterPresent is not None and t.health.adapterSense != "ok":
                raise HWError(422, "adapterPresent was sent but the adapter sense input is not reported as 'ok'.")
            if t.output is None and t.adapter is None and t.battery is None and all(
                    h is None for h in (t.health.ina219Output, t.health.ina219Adapter, t.health.ina219Battery)):
                raise HWError(422, "List at least one current sensor in health (ina219Output for a one-sensor rig).")
            if t.bootId == self.boot_id and t.seq <= self.last_seq:
                raise HWError(409, "Stale or repeated reading (sequence number did not advance).")
            self.boot_id, self.last_seq = t.bootId, t.seq
            self.tel, self.last_rx = t, now
            self.warnings = self._warnings(t)
            self._verify(t)
            # A device that latched its own emergency stop (button, firmware fail-safe) latches ours too.
            clearing = any(c.type == "clear_estop" and c.status in ("queued", "delivered") for c in self.commands.values())
            if t.estop and not self.estop and not clearing:
                self._latch_estop("the device reported an emergency stop", queue=False)
            if self.estop_reset_pending and not t.estop:
                self.estop_reset_pending = False
                self._event("Device confirmed the emergency stop is cleared. Re-arm to control it.")
            self._interlock(t)
            self._learn_and_watch(t)
            self.housekeeping()
            return self._control(now)

    def _learn_and_watch(self, t: Telemetry) -> None:
        """Learns branch currents from the output sensor and turns raw readings into events for the agents."""
        out = t.output
        if out is not None and t.source in SOURCES and out.voltageV >= SUPPLY_LOST_V and not t.estop:
            self.model.observe(t.loads, max(out.currentA, 0.0))
        # A short or a wrong part: stop everything, whatever mode we are in.
        if out is not None and out.currentA > TRIP_A and not self.estop:
            self._latch_estop(f"output current {out.currentA:.2f} A is above the {TRIP_A:.2f} A trip level", queue=True)
            self.rig_events.append({"type": "overcurrent", "currentA": round(out.currentA, 3)})
        # Is the wall adapter supplying? The sense input says so directly; without it, a collapsed bus
        # voltage while the adapter is selected says the same.
        raw = t.adapterPresent
        if raw is None and out is not None and t.source == "adapter":
            raw = out.voltageV >= SUPPLY_LOST_V
        if raw is not None:
            last, n = self._adapter_run
            n = n + 1 if raw == last else 1
            self._adapter_run = (raw, n)
            if raw is False and self.adapter_ok is not False and n >= LOST_READINGS:
                self.adapter_ok = False
                self._event("Rig: the wall adapter is not supplying (unplugged or failed).", "warning")
                if self.mode == "hardware-demo":
                    self.rig_events.append({"type": "adapter_lost", "senseV": t.adapterSenseV,
                                            "busV": None if out is None else round(out.voltageV, 2)})
            elif raw is True and self.adapter_ok is not True and n >= BACK_READINGS:
                was_lost = self.adapter_ok is False
                self.adapter_ok = True
                if was_lost:
                    self._event("Rig: the wall adapter is back.")
                    if self.mode == "hardware-demo":
                        self.rig_events.append({"type": "adapter_restored", "senseV": t.adapterSenseV})
        # Running on the power bank: is it about to switch itself off, or has it already?
        if t.source == "powerbank" and out is not None:
            if out.voltageV < SUPPLY_LOST_V:
                if self._quiet >= 0:
                    self._event("Rig: the power bank stopped supplying (empty or asleep).", "error")
                    self.rig_events.append({"type": "powerbank_off", "busV": round(out.voltageV, 2)})
                self._quiet = -1
            elif out.currentA < KEEPALIVE_A:
                self._quiet = self._quiet + 1 if self._quiet >= 0 else 1
            else:
                self._quiet = 0
        else:
            self._quiet = 0

    def pop_rig_events(self) -> list[dict]:
        with self._lock:
            out = list(self.rig_events)
            self.rig_events.clear()
            return out

    def branches(self) -> tuple[str, ...]:
        """The LED branches this rig actually has (from its telemetry), in priority order."""
        if self.tel is None:
            return LOADS
        return tuple(n for n in LOADS if n in self.tel.loads)

    def _warnings(self, t: Telemetry) -> list[str]:
        w: list[str] = []
        if t.health.muxInterlock != "ok":
            w.append("The source selector reports an interlock fault.")
        for name, hl in (("adapter", t.health.ina219Adapter), ("battery-side", t.health.ina219Battery),
                         ("output", t.health.ina219Output), ("adapter-sense", t.health.adapterSense)):
            if hl is not None and hl != "ok":
                w.append(f"The {name} sensor is {hl}: no reading is shown for it.")
        chosen = t.output if t.output is not None else {"adapter": t.adapter, "powerbank": t.battery}.get(t.source)
        if chosen is not None and t.source != "none":
            if chosen.voltageV < SUPPLY_LOST_V:
                w.append(f"No supply on the load rail ({chosen.voltageV:.2f} V): the selected source is not delivering.")
            elif chosen.voltageV < 4.4:
                w.append(f"The selected source is only {chosen.voltageV:.2f} V.")
        if t.source == "powerbank" and t.output is not None and t.output.voltageV >= SUPPLY_LOST_V and t.output.currentA < KEEPALIVE_A:
            w.append(f"The power bank is supplying only {t.output.currentA * 1000:.0f} mA. Many banks switch off below "
                     f"{KEEPALIVE_A * 1000:.0f} mA: keep a branch on, or use a bank with a low-current mode.")
        if t.source == "adapter" and t.adapterPresent is False:
            w.append("The adapter is selected but the adapter sense reads no voltage.")
        return w

    def _interlock(self, t: Telemetry) -> None:
        """Software back-up to the hardware selector: current on the source that is NOT selected means a parallel path."""
        now = self._now()
        if t.source not in SOURCES or now - self.last_source_cmd < 3.0:
            return
        other = t.battery if t.source == "adapter" else t.adapter
        if other is not None and other.currentA > PARALLEL_AMPS:
            msg = f"The non-selected source is supplying {other.currentA:.2f} A: possible parallel connection"
            self.warnings.append(msg + ".")
            if self.armed:
                self._latch_estop(msg, queue=True)

    def _verify(self, t: Telemetry) -> None:
        for c in self.commands.values():
            if c.status != "applied" or c.verified is not None:
                continue
            if c.type == "select_source" and t.source == c.params["source"]:
                c.verified = True
            elif c.type == "set_load" and t.loads.get(c.params["load"]) == c.params["on"]:
                c.verified = True

    # ------------------------------------------------------------ device command channel
    def _control(self, now: float) -> dict:
        return {
            "serverTime": round(now, 3),
            "control": {"mode": self.mode, "armed": self.armed, "armedUntilEpoch": self.armed_until if self.armed else None,
                         "estop": self.estop, "stateOfCharge": "unknown",
                         # While armed, the firmware may move to the power bank by itself the moment the adapter
                         # sense drops (an automatic transfer switch); going back is always a server command.
                         "autoTransfer": self.armed and not self.estop},
        }

    def device_heartbeat(self) -> dict:
        with self._lock:
            self.housekeeping()
            return self._control(self._now())

    def fetch_commands(self, device_id: str) -> dict:
        with self._lock:
            self.housekeeping()
            now = self._now()
            out = []
            for c in sorted(self.commands.values(), key=lambda x: x.created_at):
                if c.status not in ("queued", "delivered") or now >= c.expires_at:
                    continue
                # Safety commands go through even when disarmed; physical control only while armed.
                if c.type not in ("estop", "clear_estop") and not self.armed:
                    continue
                if c.status == "queued":
                    c.status, c.delivered_at = "delivered", now
                out.append({"id": c.id, "type": c.type, "params": c.params, "expiresAtEpoch": round(c.expires_at, 3)})
                if len(out) >= 4:
                    break
            return {**self._control(now), "commands": out}

    def ack(self, device_id: str, command_id: str, a: Ack) -> dict:
        with self._lock:
            self.housekeeping()
            now = self._now()
            if a.deviceId != device_id:
                raise HWError(403, "deviceId does not match the signed-in device.")
            c = self.commands.get(command_id)
            if c is None:
                raise HWError(404, "Unknown command.")
            if abs(now - a.ts) > MAX_SKEW_S:
                raise HWError(422, "Acknowledgement rejected: device clock is out of sync.")
            if c.status in ("applied", "rejected", "failed"):
                return {"status": c.status, "duplicate": True}  # same ack twice changes nothing
            if c.status in ("cancelled",):
                return {"status": c.status, "duplicate": False, "ignored": True}
            if c.status == "expired":
                if a.result != "applied":
                    return {"status": c.status, "duplicate": False}
                c.late = True
                self._event(f"Device applied {c.id} after it expired. Check the firmware clock check.", "warning")
            elif c.status != "delivered":
                raise HWError(409, "That command was never delivered to this device.")
            c.status, c.acked_at, c.reason = a.result, now, a.reason
            if a.result == "applied" and c.type == "select_source":
                self.last_source_cmd = now
            if a.result == "applied":
                # The device's own report; the next telemetry still has to confirm it (see _verify).
                said = (a.source == c.params.get("source")) if c.type == "select_source" else (
                    a.loads is not None and a.loads.get(c.params.get("load")) == c.params.get("on"))
                if (a.source or a.loads) and not said:
                    c.note = "The acknowledged state differs from the request: waiting for telemetry."
            what = (f"source → {'power bank' if c.params.get('source') == 'powerbank' else 'adapter'}" if c.type == "select_source"
                    else f"{c.params.get('load')} branch {'on' if c.params.get('on') else 'off'}" if c.type == "set_load"
                    else c.type.replace("_", " "))
            verb = {"applied": "did", "rejected": "refused", "failed": "failed"}[a.result]
            self._event(f"Rig {verb}: {what}{' (' + a.reason + ')' if a.reason else ''}.", "info" if a.result == "applied" else "warning")
            return {"status": c.status, "duplicate": False}

    # ------------------------------------------------------------ operator controls
    def set_mode(self, mode: str) -> dict:
        with self._lock:
            if mode not in MODES:
                raise HWError(422, "Unknown mode.")
            if mode == "hardware-demo" and not self.configured:
                raise HWError(409, "No hardware device is configured (set GRIDNOVA_DEVICE_KEYS on the server).")
            if mode != self.mode:
                self.mode = mode
                if mode == "simulation":
                    if self.armed_until is not None:
                        self._disarm("switched back to simulation")
                    else:
                        self._cancel_active("Simulation mode.", keep=("estop", "clear_estop"))
                    self.scenario = None
                self._event(f"Mode set to {mode}.")
            return self.state()

    def arm(self, minutes: int, who: str) -> dict:
        with self._lock:
            self.housekeeping()
            if self.mode != "hardware-demo":
                raise HWError(409, "Switch to hardware demo mode before arming.")
            if self.estop:
                raise HWError(409, "Emergency stop is active. Reset it first.")
            if self.device_status() != "online" or not self._fresh():
                raise HWError(409, "The device is not sending fresh readings, so it cannot be armed.")
            assert self.tel is not None
            if self.tel.estop or self.tel.health.muxInterlock != "ok":
                raise HWError(409, "The device reports an emergency stop or an interlock fault.")
            minutes = max(1, min(ARM_MAX_MIN, minutes or ARM_DEFAULT_MIN))
            self.armed_until, self.armed_by = self._now() + minutes * 60, who
            self._event(f"Hardware armed by {who} for {minutes} min.", "warning")
            return self.state()

    def disarm(self, why: str = "disarmed by operator") -> dict:
        with self._lock:
            if self.armed_until is not None:
                self._disarm(why)
            return self.state()

    def _latch_estop(self, why: str, queue: bool = True) -> None:
        self.estop, self.estop_reason, self.estop_reset_pending = True, why, False
        self.armed_until, self.armed_by, self.scenario = None, "", None
        self._cancel_active("Emergency stop.", keep=("estop",))
        if queue and not any(c.type == "estop" and c.status in ("queued", "delivered") for c in self.commands.values()):
            self._queue("estop", {}, "system", 120, check=False)
        self._event(f"EMERGENCY STOP: {why}.", "error")

    def emergency_stop(self, who: str) -> dict:
        with self._lock:
            self._latch_estop(f"pressed by {who}")
            return self.state()

    def reset_estop(self, who: str) -> dict:
        with self._lock:
            if not self.estop:
                raise HWError(409, "No emergency stop is active.")
            self.estop, self.estop_reset_pending = False, True
            for c in self.commands.values():
                if c.type == "estop" and c.status in ACTIVE:
                    c.status, c.reason = "cancelled", "Superseded by a reset."
            self._queue("clear_estop", {}, "system", 120, check=False)
            self._event(f"Emergency stop reset by {who}. Loads stay off until commanded; re-arm to control the rig.", "warning")
            return self.state()

    # ------------------------------------------------------------ command creation
    def _spec(self, type_: str, params: dict) -> dict:
        if type_ == "select_source":
            if params.get("source") not in SOURCES:
                raise HWError(422, f"source must be one of: {', '.join(SOURCES)}.")
            return {"source": params["source"]}
        if type_ == "set_load":
            load, on = params.get("load"), params.get("on")
            if load not in LOADS or not isinstance(on, bool):
                raise HWError(422, f"set_load needs load ({', '.join(LOADS)}) and on (true/false).")
            if self.tel is not None and load not in self.tel.loads:
                raise HWError(422, f"This rig has no '{load}' branch (it has: {', '.join(self.branches())}).")
            if load in ESSENTIAL and on is False:
                raise HWError(422, "The critical branch can never be switched off by a command.")
            return {"load": load, "on": on}
        if type_ in ("estop", "clear_estop"):
            return {}
        raise HWError(422, "That command is not on the allow-list.")

    def _queue(self, type_: str, params: dict, origin: str, ttl: int, *, incident: str | None = None,
               idem: str | None = None, status: str = "queued", check: bool = True) -> tuple[Command, bool]:
        """Creates a command (or returns the identical one already waiting). Returns (command, duplicate)."""
        params = self._spec(type_, params)
        now = self._now()
        if check:
            if self.mode != "hardware-demo":
                raise HWError(409, "Hardware demo mode is off: nothing is sent to the rig.")
            if self.estop:
                raise HWError(409, "Emergency stop is active.")
            if not self.armed:
                raise HWError(409, "Hardware is not armed. An operator must arm it first.")
            if not self._fresh():
                raise HWError(409, "No fresh readings from the device, so nothing was sent.")
            if type_ == "select_source" and now - self.last_source_cmd < SOURCE_COOLDOWN_S:
                raise HWError(429, "The source selector was switched a moment ago. Wait a few seconds.")
        for c in self.commands.values():
            if c.status in ACTIVE and ((idem and c.idem == idem) or (c.type == type_ and c.params == params and c.origin == origin)):
                return c, True
        if check and sum(1 for c in self.commands.values() if c.status in ACTIVE) >= MAX_ACTIVE_COMMANDS:
            raise HWError(429, "Too many commands are already waiting.")
        ttl = ttl if type_ in ("estop", "clear_estop") else min(ttl, CMD_TTL_MAX_S)
        c = Command(f"cmd-{secrets.token_hex(6)}", type_, params, origin, now, now + ttl, ttl, status, incident, idem)
        self.commands[c.id] = c
        return c, False

    def submit(self, body: CommandBody, who: str) -> dict:
        """A hand-issued command from a signed-in operator (still needs the rig armed)."""
        with self._lock:
            self.housekeeping()
            params = {"source": body.source} if body.type == "select_source" else {"load": body.load, "on": body.on}
            c, dup = self._queue(body.type, params, "operator", body.ttlS, idem=body.idempotencyKey)
            if not dup:
                self._event(f"{who} queued {c.type} {c.params}.")
            return {"command": c.to_json(), "duplicate": dup}

    # ------------------------------------------------------------ scenarios
    def capabilities(self) -> dict:
        return {
            "scenarios": CAPABILITIES,
            "commands": ["select_source", "set_load"],
            "sources": list(SOURCES),
            "loads": [{"name": n, "essential": n in ESSENTIAL} for n in self.branches()],
            "stateOfCharge": "unknown",
            "scale": "tabletop-usb",
        }

    def _result(self, outcome: str, reason: str, ids: list[str] | None = None, performed: bool = False) -> dict:
        return {
            "dataSource": "hardware-demo" if self.mode == "hardware-demo" else "simulation",
            "outcome": outcome,  # simulated_only | software_only | unsupported_on_hardware | awaiting_approval | hardware_pending
            "physicallyPerformed": performed,
            "reason": reason,
            "commandIds": ids or [],
        }

    def plan_for_scenario(self, type_: str, severity: int, incident_id: str, auto_transfer: bool = False) -> dict:
        """Called when a scenario starts. Never raises: the simulation always runs regardless.

        auto_transfer: the rig itself reported the outage (adapter unplugged). Moving to the power bank only
        restores supply, so it goes out at once, like an automatic transfer switch; shedding branches still
        waits for the operator's approval.
        """
        with self._lock:
            self.housekeeping()
            self._restore_previous()
            cap = CAPABILITIES.get(type_)
            if cap is None:
                return self._result("simulated_only", "Unknown scenario.")
            if self.mode != "hardware-demo":
                return self._result("simulated_only", "Hardware demo mode is off. Simulation only.")
            if type_ == "cloud_cover":
                return self._result("software_only", cap["summary"])
            if type_ == "line_failure":
                return self._result("unsupported_on_hardware", cap["summary"])
            if not self.armed:
                return self._result("simulated_only", "Hardware is not armed, so nothing was sent to the rig.")
            if not self._fresh() or self.tel is None:
                return self._result("simulated_only", "No fresh readings from the rig, so nothing was sent.")
            loads = self.tel.loads
            have = self.branches()
            sc = Scenario(incident_id, type_, severity)
            specs: list[tuple[str, dict]] = []
            now_spec: list[tuple[str, dict]] = []
            if type_ == "heatwave":
                n = min(3, math.ceil(severity / 2))
                off = [name for name in ADD_ORDER if name in have and loads.get(name) is False][:n]
                specs = [("set_load", {"load": name, "on": True}) for name in off]
                sc.restore = [("set_load", {"load": name, "on": False}) for name in off]
                if not specs:
                    return self._result("simulated_only", "Every non-essential LED branch is already on, so there was nothing to add.")
            else:  # grid_outage
                transfer = [("select_source", {"source": "powerbank"})] if self.tel.source != "powerbank" else []
                if auto_transfer:
                    now_spec = transfer
                else:
                    specs = list(transfer)
                # The firmware may already have switched over by itself (local automatic transfer while armed).
                sc.restore = [("select_source", {"source": "adapter"})] if (transfer or auto_transfer) else []
                if auto_transfer:
                    sc.restore_now = list(sc.restore)
                # Shed non-essential branches, but never so far that the power bank falls below its keep-alive
                # current (it would switch itself off and take the critical branch with it). The learned rig
                # model predicts the current of each step.
                state = dict(loads)
                shed = []
                for n in [n for n in SHED_ORDER if n in have and loads.get(n) is True][: max(0, severity - 2)]:
                    trial = {**state, n: False}
                    if self.model.predict(state) >= KEEPALIVE_A > self.model.predict(trial):
                        self._event(f"Kept the {n} branch on so the power bank stays above its {KEEPALIVE_A * 1000:.0f} mA keep-alive current.")
                        break
                    state, shed = trial, shed + [n]
                specs += [("set_load", {"load": n, "on": False}) for n in shed]
                sc.restore += [("set_load", {"load": n, "on": True}) for n in shed]
            hold = bool(cap["approval"])
            try:
                made_now = [self._queue(t, p, "scenario", CMD_TTL_DEFAULT_S, incident=incident_id)[0] for t, p in now_spec]
                made = [self._queue(t, p, "scenario", CMD_TTL_DEFAULT_S, incident=incident_id,
                                    status="awaiting_approval" if hold else "queued")[0] for t, p in specs]
            except HWError as e:
                return self._result("simulated_only", e.message)
            if made_now:
                self._event(f"Automatic transfer to the power bank for {incident_id}: the adapter is not supplying.", "warning")
            sc.command_ids, sc.awaiting_approval = [c.id for c in made_now + made], hold and bool(made)
            self.scenario = sc
            self._event(f"{type_} plan for {incident_id}: {len(made)} command(s){' waiting for approval' if hold else ' queued'}.")
            if hold and made:
                msg = ("Switched the rig to the power bank; shedding branches waits for the operator's approval."
                       if made_now else "The outage plan for the rig waits for the same operator approval as the simulation.")
                return self._result("awaiting_approval", msg, sc.command_ids)
            if made_now and not made:
                return self._result("hardware_pending", "Switched the rig to the power bank. No branch needs shedding.", sc.command_ids)
            return self._result("hardware_pending", cap["summary"], sc.command_ids)

    def on_approval(self, incident_id: str | None, status: str) -> dict | None:
        """The operator answered the orchestrator's approval request: release or drop the held rig commands."""
        with self._lock:
            sc = self.scenario
            if sc is None or not sc.awaiting_approval or sc.incident_id != incident_id:
                return None
            now = self._now()
            sc.awaiting_approval = False
            held = [self.commands[i] for i in sc.command_ids if i in self.commands and self.commands[i].status == "awaiting_approval"]
            if status == "rejected":
                for c in held:
                    c.status, c.reason = "cancelled", "Operator rejected the plan."
                self.scenario = None
                return self._result("simulated_only", "Plan rejected: nothing was sent to the rig.")
            if not (self.armed and self._fresh() and not self.estop):
                for c in held:
                    c.status, c.reason = "cancelled", "The rig was no longer armed with fresh readings."
                self.scenario = None
                return self._result("simulated_only", "Approved, but the rig was no longer armed with fresh readings. Simulation only.")
            for c in held:
                c.status, c.created_at, c.expires_at = "queued", now, now + c.ttl_s
            self._event(f"Operator approved {incident_id}: {len(held)} command(s) released to the rig.", "warning")
            return self._result("hardware_pending", "Approved by the operator and queued for the rig.", [c.id for c in held])

    def _restore_previous(self) -> None:
        sc, self.scenario = self.scenario, None
        if sc is None:
            return
        for i in sc.command_ids:
            c = self.commands.get(i)
            if c and c.status in ("awaiting_approval", "queued"):
                c.status, c.reason = "cancelled", "Scenario ended."
        if not (self.armed and self._fresh() and not self.estop):
            return
        # Approval never came: only the steps that ran without it (the automatic transfer) are undone.
        steps = sc.restore_now if sc.awaiting_approval else sc.restore
        for t, p in steps:
            if t == "select_source" and p.get("source") == "adapter" and self.adapter_ok is False:
                self._event("Not switching back to the adapter: it is still not supplying.", "warning")
                continue
            try:
                self._queue(t, p, "scenario", CMD_TTL_DEFAULT_S, incident=sc.incident_id)
            except HWError:
                self._event(f"Could not queue the restore step {t} {p}.", "warning")
        if steps:
            self._event(f"Scenario {sc.incident_id} ended: restoring the rig's previous state.")

    def release_scenario(self) -> None:
        with self._lock:
            self.housekeeping()
            self._restore_previous()

    # ------------------------------------------------------------ reporting
    def _reading(self, rd: Reading | None) -> dict | None:
        if rd is None:
            return None
        w = round(rd.voltageV * max(rd.currentA, 0.0), 3)
        return {"voltageV": round(rd.voltageV, 3), "currentA": round(rd.currentA, 3), "powerW": w,
                "kind": "measured", "powerKind": "computed (V x I)", "fresh": self._fresh()}

    def state(self) -> dict:
        with self._lock:
            self.housekeeping()
            now = self._now()
            t = self.tel
            device = {
                "id": t.deviceId if t else None,
                "status": self.device_status(),
                "lastSeenAt": _iso(self.last_rx),
                "ageS": None if self.last_rx is None else round(now - self.last_rx, 1),
                "firmware": t.firmware if t else None,
                "source": t.source if t else None,
                "loads": t.loads if t else {},
                "readings": {
                    "adapter": self._reading(t.adapter) if t else None,
                    "battery": self._reading(t.battery) if t else None,
                    "output": self._reading(t.output) if t else None,
                },
                "adapter": {"present": self.adapter_ok, "senseV": t.adapterSenseV if t else None,
                            "sensed": bool(t and t.health.adapterSense == "ok")},
                "sensorLayout": None if t is None else ("output" if t.health.ina219Output is not None else "per-source"),
                "branches": list(self.branches()) if t else [],
                "model": self.model.to_json(),
                "predictedCurrentA": round(self.model.predict(t.loads), 3) if t else None,
                "health": t.health.model_dump() if t else None,
                "warnings": list(self.warnings),
                "stateOfCharge": SOC_UNKNOWN,
            }
            cmds = sorted(self.commands.values(), key=lambda c: c.created_at, reverse=True)[:12]
            sc = self.scenario
            return {
                "dataSource": self.mode,  # what the Hardware panel is showing; campus numbers stay "simulation"
                "campusDataSource": "simulation",
                "mode": self.mode,
                "scale": "tabletop-usb",
                "notCampusPower": True,
                "configured": self.configured,
                "armed": self.armed,
                "armedUntil": _iso(self.armed_until) if self.armed else None,
                "armedBy": self.armed_by if self.armed else None,
                "estop": {"active": self.estop, "reason": self.estop_reason if self.estop else None, "resetPending": self.estop_reset_pending},
                "device": device,
                "commands": [c.to_json() for c in cmds],
                "scenario": None if sc is None else {"incidentId": sc.incident_id, "type": sc.type, "awaitingApproval": sc.awaiting_approval},
                "events": list(self.events)[:10],
                "capabilities": self.capabilities(),
                "limits": {"freshS": FRESH_S, "offlineAfterS": OFFLINE_AFTER_S, "armMaxMin": ARM_MAX_MIN, "commandTtlS": CMD_TTL_DEFAULT_S,
                           "keepAliveA": KEEPALIVE_A, "tripA": TRIP_A, "supplyLostV": SUPPLY_LOST_V},
                "serverTime": _iso(now),
            }

    def summary(self) -> dict:
        with self._lock:
            return {"mode": self.mode, "armed": self.armed, "device": self.device_status(), "estop": self.estop}


service = HardwareService()
