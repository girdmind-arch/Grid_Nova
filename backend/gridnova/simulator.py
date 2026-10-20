"""Grid physics shared by the live grid, the digital twin and the evaluation.

One `step()` advances the campus by `dt_h` hours: building loads, solar,
battery dispatch and grid import, always balanced so that
solar + battery + grid = demand (minus any load that could not be served).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field, replace

from . import campus as c

# Cooling load rises ~2.5% per °C above the temperature the profile was built for.
COOLING_PER_DEG = 0.025


@dataclass
class Conditions:
    """What the world is doing (not under the agents' control)."""

    demand_factor: float = 1.0  # day-to-day weather variation
    solar_factor: float = 1.0  # 1.0 = clear sky; cloud cover lowers it
    heat_severity: int = 0  # heatwave severity 0-5
    outage: bool = False  # main grid supply lost
    line_fault_zone: str | None = None  # building whose feeder tripped
    # Live weather: sim hour -> (solar kW from irradiance, temperature °C). None = typical profile.
    weather: Callable[[float], tuple[float, float]] | None = None
    # What-if settings (None = the campus defaults).
    battery_kwh: float | None = None
    solar_scale: float = 1.0
    temp_offset_c: float = 0.0
    peak_rate: float | None = None

    @property
    def capacity_kwh(self) -> float:
        return self.battery_kwh if self.battery_kwh is not None else c.BATTERY_CAPACITY_KWH

    def solar_and_temp(self, hour: float) -> tuple[float, float]:
        """Available (pre-fault) solar and outdoor temperature at a sim hour."""
        from .weather import reference_temp_c

        if self.weather is not None:
            solar, temp = self.weather(hour)
        else:
            solar, temp = c.clear_sky_solar_kw(hour), reference_temp_c(hour)
        return solar * self.solar_scale, temp + self.temp_offset_c

    def rate(self, hour: float) -> float:
        slab = c.tariff_at(hour)
        if slab.slab == "peak" and self.peak_rate is not None:
            return self.peak_rate
        return slab.rate


@dataclass
class Policy:
    """What the controller does. The no-AI baseline uses Policy.baseline()."""

    ai: bool = True
    night_charge_to_pct: float | None = 82.0  # off-peak charging target
    peak_target_kw: float | None = None  # cap grid import 18:00-22:00 using the battery
    extra_discharge_kw: float = 0.0  # e.g. heatwave support
    bridge_solar_gap: bool = False  # battery covers solar lost to clouds
    precool: bool = False  # hostels pre-cool 17:30-18:00, then run 6% lighter in the peak
    hvac_trim: bool = False  # library/admin HVAC scheduling 09:00-18:00 (-5%)
    reroute_fraction: float | None = None  # line fault: share of the building restored via F2
    outage_hostel_level: float = 0.0  # grid outage: hostel power level (0 = off)
    reserve_floor_pct: float = c.BATTERY_FLOOR_PCT
    # A learned battery controller (the Planner's RL policy): called every step with
    # (hour, battery %, net load kW, today's highest import so far) and returns a battery
    # setpoint in kW (+ discharge, - charge). When set, it replaces the rule-based dispatch;
    # physical limits (floor, ceiling, inverter, contract limit) still apply in dispatch_setpoint().
    controller: Callable[[float, float, float, float], float] | None = None

    @staticmethod
    def baseline() -> "Policy":
        return Policy(ai=False, night_charge_to_pct=None)


@dataclass
class ZoneLoad:
    id: str
    kw: float
    status: str  # normal | reduced | faulted | isolated
    note: str | None = None


@dataclass
class Battery:
    soc_pct: float = 82.0

    @property
    def energy_kwh(self) -> float:
        return self.soc_pct / 100 * c.BATTERY_CAPACITY_KWH


@dataclass
class Totals:
    energy_cost_inr: float = 0.0
    penalty_inr: float = 0.0
    max_import_kw: float = 0.0
    unserved_kwh: float = 0.0
    min_soc_pct: float = 100.0
    max_soc_pct: float = 0.0
    max_feeder_ratio: float = 0.0
    labs_unpowered: bool = False
    served_kwh: float = 0.0
    requested_kwh: float = 0.0
    dark_kwh: float = 0.0  # demand of buildings left with no power at all

    @property
    def cost_inr(self) -> float:
        return self.energy_cost_inr + self.penalty_inr


@dataclass
class StepResult:
    hour: float
    zones: list[ZoneLoad]
    demand_kw: float
    solar_kw: float
    battery_kw: float  # + discharging, - charging
    grid_kw: float
    unserved_kw: float
    feeder_load: dict[str, float] = field(default_factory=dict)


# Overnight charging never pushes grid import above this when no evening cap is set.
NIGHT_IMPORT_CAP_KW = 1100.0

# Hours in which the battery caps grid import (the evening ramp plus the 18:00-22:00 tariff peak).
PEAK_WINDOW = (17.0, 22.0)

HVAC_KINDS = {"hostel", "library", "admin", "academic", "residence"}

# What buildings would draw with nobody curtailing them (for the comfort score).
REQUEST_POLICY = Policy(ai=True, night_charge_to_pct=None, reroute_fraction=1.0, outage_hostel_level=1.0)


# Most a battery may charge at (kW): matches the rule-based overnight charging.
CHARGE_MAX_KW = 400.0


def dispatch_setpoint(setpoint_kw: float, soc_pct: float, net_kw: float, dt_h: float, cap_kwh: float, floor_pct: float) -> float:
    """What the battery can actually do for a requested setpoint (+ discharge, - charge).

    Shared by the simulator and the RL training environment, so the agent learns on exactly
    the physics it is later run on: reserve floor, 90% ceiling, inverter rating, round-trip
    losses, no export to the grid, and charging never pushes import over the contract limit.
    """
    if cap_kwh <= 0 or dt_h <= 0:
        return 0.0
    max_kw = c.BATTERY_MAX_KW * min(1.0, cap_kwh / c.BATTERY_CAPACITY_KWH)
    if setpoint_kw >= 0:
        usable_kwh = max(0.0, (soc_pct - floor_pct) / 100 * cap_kwh)
        return min(setpoint_kw, max_kw, usable_kwh * c.BATTERY_EFF / dt_h, max(net_kw, 0.0))
    room_kwh = max(0.0, (c.BATTERY_CEIL_PCT - soc_pct) / 100 * cap_kwh)
    headroom = max(0.0, c.CONTRACT_LIMIT_KW - net_kw)
    return -min(-setpoint_kw, CHARGE_MAX_KW, room_kwh / c.BATTERY_EFF / dt_h, headroom)


def zone_loads(hour: float, cond: Conditions, pol: Policy) -> list[ZoneLoad]:
    from .weather import reference_temp_c

    h = hour % 24
    _, temp = cond.solar_and_temp(hour)
    # Hotter or cooler than the profile's typical day changes the cooling load.
    temp_factor = min(1.4, max(0.7, 1 + COOLING_PER_DEG * (temp - reference_temp_c(h))))
    out: list[ZoneLoad] = []
    for z in c.ZONES:
        kw = c.zone_baseline_kw(z, h) * cond.demand_factor
        if z.kind in HVAC_KINDS:
            kw *= temp_factor
        status, note = "normal", None

        if cond.heat_severity:
            kw *= 1 + (0.04 if z.kind in HVAC_KINDS else 0.01) * cond.heat_severity

        if pol.ai:
            if pol.hvac_trim and z.kind in {"library", "admin", "academic"} and 9 <= h < 18:
                kw *= 0.95
            if pol.precool and z.kind == "hostel":
                if 17.5 <= h < 18:
                    kw *= 1.04
                    status, note = "reduced", "Pre-cooling"
                elif 18 <= h < 22:
                    kw *= 0.94
                    status, note = "reduced", "Pre-cooled, +1°C"

        if cond.line_fault_zone == z.id:
            if pol.ai and pol.reroute_fraction:
                kw *= pol.reroute_fraction
                status, note = "reduced", "On backup feeder F2"
            else:
                kw, status, note = 0.0, "faulted", "Feeder F3 fault"

        if cond.outage and z.kind == "hostel":
            level = pol.outage_hostel_level if pol.ai else 0.0
            if level > 0:
                kw *= level
                status, note = "reduced", f"Running at {round(level * 100)}%"
            else:
                kw, status, note = 0.0, "faulted", "No supply"

        out.append(ZoneLoad(z.id, kw, status, note))
    return out


def feeder_loads(zones: list[ZoneLoad], cond: Conditions) -> dict[str, float]:
    loads = {f: 0.0 for f in c.FEEDER_RATING_KW}
    for zl in zones:
        feeder = c.ZONE_BY_ID[zl.id].feeder
        if cond.line_fault_zone == zl.id and zl.kw > 0:
            feeder = "F2"  # rerouted through the tie switch
        loads[feeder] += zl.kw
    return loads


def step(bat: Battery, tot: Totals, hour: float, dt_h: float, cond: Conditions, pol: Policy) -> StepResult:
    h = hour % 24
    zones = zone_loads(hour, cond, pol)
    demand = sum(z.kw for z in zones)
    clear_solar, _ = cond.solar_and_temp(hour)
    solar = clear_solar * cond.solar_factor
    net = demand - solar  # what battery + grid must supply
    cap_kwh = cond.capacity_kwh

    usable_kwh = max(0.0, (bat.soc_pct - pol.reserve_floor_pct) / 100 * cap_kwh)
    room_kwh = max(0.0, (c.BATTERY_CEIL_PCT - bat.soc_pct) / 100 * cap_kwh)
    max_kw = c.BATTERY_MAX_KW * min(1.0, cap_kwh / c.BATTERY_CAPACITY_KWH) if cap_kwh > 0 else 0.0
    # dt_h == 0 is an instant snapshot: any charge above the floor can deliver full power.
    max_out = min(max_kw, usable_kwh * c.BATTERY_EFF / dt_h) if dt_h > 0 else (max_kw if usable_kwh > 0 else 0.0)

    battery = 0.0
    if cond.outage:
        # Islanded: the battery is the only source besides solar.
        battery = min(max(net, 0.0), max_out)
    elif pol.ai and pol.controller is not None:
        # dt_h == 0 is a snapshot: show what the controller would do over the next minute.
        battery = dispatch_setpoint(pol.controller(hour, bat.soc_pct, net, tot.max_import_kw), bat.soc_pct, net, dt_h or 1 / 60, cap_kwh, pol.reserve_floor_pct)
    elif pol.ai:
        if pol.night_charge_to_pct is not None and (h < 6 or h >= 22) and bat.soc_pct < pol.night_charge_to_pct:
            # Charge at off-peak rates without creating a new import peak.
            cap = pol.peak_target_kw if pol.peak_target_kw is not None else NIGHT_IMPORT_CAP_KW
            headroom = max(0.0, cap - net)
            battery = -min(300.0, headroom, room_kwh / c.BATTERY_EFF / dt_h if dt_h > 0 else (300.0 if room_kwh > 0 else 0.0))
        else:
            want = pol.extra_discharge_kw
            if pol.bridge_solar_gap:
                want += clear_solar - solar
            if pol.peak_target_kw is not None and PEAK_WINDOW[0] <= h < PEAK_WINDOW[1]:
                want = max(want, net - pol.peak_target_kw)
            battery = min(max(want, 0.0), max_out, max(net, 0.0))

    grid = 0.0 if cond.outage else net - battery
    unserved = max(0.0, net - battery) if cond.outage else 0.0

    # Battery bookkeeping (efficiency losses both ways).
    if cap_kwh > 0 and battery > 0:
        bat.soc_pct -= battery * dt_h / c.BATTERY_EFF / cap_kwh * 100
    elif cap_kwh > 0 and battery < 0:
        bat.soc_pct += -battery * dt_h * c.BATTERY_EFF / cap_kwh * 100

    rate = cond.rate(h)
    if grid > 0:
        tot.energy_cost_inr += grid * dt_h * rate
        if grid > c.CONTRACT_LIMIT_KW:
            tot.penalty_inr += (grid - c.CONTRACT_LIMIT_KW) * dt_h * c.EXCESS_PENALTY_INR_PER_KWH
    tot.max_import_kw = max(tot.max_import_kw, grid)
    tot.unserved_kwh += unserved * dt_h
    tot.min_soc_pct = min(tot.min_soc_pct, bat.soc_pct)
    tot.max_soc_pct = max(tot.max_soc_pct, bat.soc_pct)
    feeders = feeder_loads(zones, cond)
    tot.max_feeder_ratio = max(tot.max_feeder_ratio, *(kw / c.FEEDER_RATING_KW[f] for f, kw in feeders.items()))
    if any(z.kw <= 0 and c.ZONE_BY_ID[z.id].kind == "lab" for z in zones):
        tot.labs_unpowered = True
    # Comfort bookkeeping: what each building got vs. what it asked for.
    asked = zone_loads(hour, cond, REQUEST_POLICY)
    requested = sum(z.kw for z in asked)
    tot.requested_kwh += requested * dt_h
    tot.dark_kwh += sum(a.kw for a, z in zip(asked, zones) if z.kw <= 0) * dt_h
    tot.served_kwh += max(0.0, demand - unserved) * dt_h

    return StepResult(h, zones, demand, solar, battery, grid, unserved, feeders)


def simulate(
    start_hour: float,
    end_hour: float,
    cond: Conditions,
    pol: Policy,
    soc_pct: float,
    dt_min: float = 5.0,
) -> tuple[Battery, Totals, list[StepResult]]:
    """Runs the campus from start_hour to end_hour (hours since midnight, may exceed 24)."""
    bat = Battery(soc_pct)
    tot = Totals()
    dt_h = dt_min / 60
    steps: list[StepResult] = []
    t = start_hour
    while t < end_hour - 1e-9:
        dt = min(dt_h, end_hour - t)
        steps.append(step(bat, tot, t, dt, cond, pol))
        t += dt
    return bat, tot, steps


def best_peak_target(start_hour: float, cond: Conditions, pol: Policy, soc_pct: float, end_hour: float = 22.0) -> float:
    """Lowest grid-import cap for the evening peak that the battery can sustain to end_hour.

    Binary search in the digital twin: a lower cap saves more but drains the
    battery faster. The answer keeps the battery just above its reserve floor.
    """
    lo, hi = 0.0, 2500.0
    for _ in range(18):
        mid = (lo + hi) / 2
        bat, _, _ = simulate(start_hour, end_hour, cond, replace(pol, peak_target_kw=mid), soc_pct, dt_min=5)
        if bat.soc_pct >= pol.reserve_floor_pct + 0.5:
            hi = mid
        else:
            lo = mid
    return round(hi)
