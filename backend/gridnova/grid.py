"""The live campus grid: clock, weather, the current fault and the controller.

Two clock modes:
  live  real Indian time (IST) and real weather; the day rolls over at midnight
        and "cost today" resets like a real meter.
  demo  today's real weather from 17:20, just before the evening peak, running
        at 1x, 10x or 60x so the peak can be watched in a few minutes.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

from .simulator import Battery, Conditions, Policy, StepResult, Totals, best_peak_target, simulate, step
from .weather import Weather

IST = timezone(timedelta(hours=5, minutes=30))
DEMO_START_HOUR = 17 + 20 / 60
STEP_MIN = 1.0
MAX_CATCH_UP_H = 36.0  # if the server was asleep, don't replay more than this


def iso(dt: datetime) -> str:
    return dt.astimezone(IST).isoformat(timespec="seconds")


def midnight_ist(now: datetime | None = None) -> datetime:
    n = (now or datetime.now(IST)).astimezone(IST)
    return n.replace(hour=0, minute=0, second=0, microsecond=0)


@dataclass
class Fault:
    type: str  # cloud_cover | heatwave | line_failure | grid_outage
    severity: int
    duration_min: int
    incident_id: str
    started_hour: float
    target_zone_id: str | None = None
    mitigated: bool = False
    origin: str = "website"  # website | rig (started by a physical event on the tabletop rig)
    note: str = ""


def apply_fault(base: Conditions, fault: Fault | None) -> Conditions:
    if not fault:
        return base
    if fault.type == "cloud_cover":
        return replace(base, solar_factor=max(0.0, 1 - 0.15 * fault.severity))
    if fault.type == "heatwave":
        return replace(base, heat_severity=fault.severity)
    if fault.type == "line_failure":
        return replace(base, line_fault_zone=fault.target_zone_id or "hostel-gh1")
    if fault.type == "grid_outage":
        return replace(base, outage=True)
    return base


class LiveGrid:
    """Holds the live state. All public methods are thread-safe."""

    def __init__(self, weather: Weather | None = None, wall=time.time, clock_mode: str | None = None):
        self.weather = weather or Weather(fetch=False)
        self._wall = wall
        self._lock = threading.RLock()
        self.mode = "ai"  # ai | fallback | manual
        self.mode_since = self._wall()  # when a non-AI mode was switched on
        self.fault: Fault | None = None
        self.incident_counter = 41
        self.clock_mode = clock_mode or os.environ.get("GRIDNOVA_CLOCK", "live")
        self.speed = 1.0
        self.policy = self.default_policy()
        self._reset_clock()

    # ---------- time ----------
    def at(self, hour: float) -> datetime:
        """Sim hour (hours since the sim day's midnight) -> datetime."""
        return self.day + timedelta(hours=hour)

    def _now_ist(self) -> datetime:
        return datetime.fromtimestamp(self._wall(), IST)

    def _target_hour(self) -> float:
        if self.clock_mode == "live":
            return (self._now_ist() - self.day).total_seconds() / 3600
        return self._anchor_hour + (self._wall() - self._anchor_wall) * self.speed / 3600

    def hour(self) -> float:
        with self._lock:
            self._advance()
            return self._hour

    def now(self) -> datetime:
        return self.at(self.hour())

    def conditions(self, fault: Fault | None = "current") -> Conditions:  # type: ignore[assignment]
        """Live weather plus the effect of a fault (the current one by default)."""
        base = Conditions(weather=self._weather_fn)
        return apply_fault(base, self.fault if fault == "current" else fault)

    def _weather_fn(self, hour: float) -> tuple[float, float]:
        solar, temp, _, _ = self.weather.at(self.at(hour))
        return solar, temp

    # ---------- clock control ----------
    def set_clock(self, mode: str, speed: float):
        with self._lock:
            self.clock_mode = mode
            self.speed = speed if mode == "demo" else 1.0
            self.fault = None
            self.mode = "ai"
            self._reset_clock()

    def _reset_clock(self):
        """Starts the day: simulates midnight -> now so today's cost and battery level are real."""
        self.day = midnight_ist(self._now_ist())
        start = (self._now_ist() - self.day).total_seconds() / 3600 if self.clock_mode == "live" else DEMO_START_HOUR
        self._anchor_hour, self._anchor_wall = start, self._wall()
        base = Conditions(weather=self._weather_fn)
        reserve = self.policy.reserve_floor_pct
        self.policy = replace(self.default_policy(), reserve_floor_pct=reserve)
        pre = replace(self.policy, peak_target_kw=self._evening_target(0.0, 70.0, base))
        bat, tot, _ = simulate(0, start, base, pre, soc_pct=70.0, dt_min=5)
        _, base_tot, _ = simulate(0, start, base, Policy.baseline(), soc_pct=70.0, dt_min=5)
        self.battery: Battery = bat
        self.totals: Totals = tot
        self.base_battery = Battery(70.0)
        self.base_totals: Totals = base_tot
        self._hour = start
        self.replan_peak()
        self.last: StepResult = self.snapshot_unlocked()

    def _evening_target(self, from_hour: float, soc: float, cond: Conditions) -> float:
        """Battery import cap for the next evening peak, sized in the twin."""
        # Sized for a rule-based cap, whatever controls the battery right now (e.g. the learned policy).
        pol = replace(self.policy, controller=None, night_charge_to_pct=self.policy.night_charge_to_pct or 82.0)
        day_start = from_hour - (from_hour % 24)
        evening = day_start + 17 if from_hour % 24 < 22 else day_start + 24 + 17
        start = max(from_hour, evening)
        if from_hour < evening:
            # Battery state by 17:00 if nothing else happens before then.
            bat, _, _ = simulate(from_hour, evening, cond, replace(pol, peak_target_kw=None), soc, dt_min=10)
            soc = bat.soc_pct
        return best_peak_target(start, cond, pol, soc, end_hour=evening + 5)

    def replan_peak(self):
        with self._lock:
            self.policy.peak_target_kw = self._evening_target(self._hour, self.battery.soc_pct, self.conditions(None))

    def _advance(self):
        target = self._target_hour()
        if target - self._hour > MAX_CATCH_UP_H:
            self._reset_clock()
            return
        dt_h = STEP_MIN / 60
        while self._hour + dt_h <= target:
            cond = self.conditions()
            self.last = step(self.battery, self.totals, self._hour, dt_h, cond, self.active_policy())
            step(self.base_battery, self.base_totals, self._hour, dt_h, cond, Policy.baseline())
            self._hour += dt_h
            if self._hour >= 24:
                self._new_day()
                target -= 24  # same moment, measured from the new midnight

    def _new_day(self):
        """Midnight: the meter for "today" starts again; the battery carries over."""
        self.day += timedelta(days=1)
        self._hour -= 24
        self._anchor_hour -= 24
        if self.fault:
            self.fault.started_hour -= 24
        self.totals = Totals()
        self.base_totals = Totals()

    # ---------- control ----------
    def default_policy(self) -> Policy:
        return Policy(ai=True, night_charge_to_pct=82.0, precool=True, hvac_trim=True)

    def active_policy(self) -> Policy:
        """What actually runs: the agents' policy, or safe fixed rules."""
        if self.mode == "ai":
            return self.policy
        outage = bool(self.fault and self.fault.type == "grid_outage")
        return Policy(
            ai=True,
            night_charge_to_pct=82.0,
            reroute_fraction=self.policy.reroute_fraction,
            outage_hostel_level=(self.policy.outage_hostel_level or 0.5) if outage else 0.0,
        )

    def snapshot_unlocked(self) -> StepResult:
        return step(Battery(self.battery.soc_pct), Totals(), self._hour, 0.0, self.conditions(), self.active_policy())

    def snapshot(self) -> StepResult:
        """A zero-length step at the current time (no state change)."""
        with self._lock:
            self._advance()
            return self.snapshot_unlocked()

    def start_fault(self, type_: str, severity: int, duration_min: int, target_zone_id: str | None,
                    origin: str = "website", note: str = "") -> Fault:
        with self._lock:
            self._advance()
            self.incident_counter += 1
            if type_ == "line_failure":
                target_zone_id = target_zone_id or "hostel-gh1"
            self.fault = Fault(type_, max(1, min(5, severity)), duration_min, f"INC-{self.incident_counter}", self._hour, target_zone_id,
                               origin=origin, note=note)
            self.mode = "ai"
            # The fault hits before anyone reacts: drop any earlier scenario response.
            keep = self.policy
            self.policy = replace(
                self.default_policy(),
                peak_target_kw=keep.peak_target_kw,
                reserve_floor_pct=keep.reserve_floor_pct,
                night_charge_to_pct=keep.night_charge_to_pct,
            )
            return self.fault

    def clear_fault(self):
        with self._lock:
            self._advance()
            self.fault = None
            self.mode = "ai"
            self.policy = replace(self.default_policy(), reserve_floor_pct=self.policy.reserve_floor_pct)
            self.replan_peak()

    def apply_policy(self, pol: Policy, mitigated: bool = True):
        with self._lock:
            self._advance()
            self.policy = pol
            if self.fault and mitigated:
                self.fault.mitigated = True

    def set_mode(self, mode: str):
        with self._lock:
            self._advance()
            self.mode = mode
            self.mode_since = self._wall()

    def expire_mode(self, ttl_s: float) -> bool:
        """Hands control back to the agents once a Fallback / Manual switch has been left on too long.

        The backend is shared by every visitor, so one person leaving Manual on would
        otherwise silence the agents for everyone, indefinitely. Returns True if it reset.
        """
        with self._lock:
            if self.mode != "ai" and ttl_s > 0 and self._wall() - self.mode_since >= ttl_s:
                self.mode = "ai"
                return True
            return False

    # ---------- reporting ----------
    def environment(self) -> dict:
        with self._lock:
            when = self.at(self._hour)
        solar, temp, cloud, live = self.weather.at(when)
        status = self.weather.status()
        from .locations import tariff_for

        return {
            "clock": self.clock_mode,
            "speed": self.speed,
            "weatherSource": status["source"] if live else "profile",
            "location": status["location"],
            "state": status["state"],
            "discom": tariff_for(status["state"]).discom,
            "temperatureC": round(temp, 1),
            "cloudPct": round(cloud),
            "solarPotentialKw": round(solar),
            "weatherUpdatedAt": status["updatedAt"],
        }
