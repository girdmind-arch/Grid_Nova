"""One simulated campus day as a reinforcement-learning environment.

The agent controls only the battery, every 15 minutes, for 24 hours. Building loads and solar
come from the same campus model the live grid uses (gridnova.simulator.zone_loads) and do not
depend on the battery, so they are computed once per day; the battery itself goes through
gridnova.simulator.dispatch_setpoint, the exact physics the live grid and the twin run.

Each training day draws its own weather and campus: busier or quieter days, clouds, hotter or
cooler weather, sometimes a heatwave, and a starting charge between 35% and 85%.

Reward = minus the money the campus pays: energy at the time-of-day tariff, the excess penalty
above the contract limit, the demand charge on the day's highest import (paid as it rises),
and at the end of the day the value of the energy left in the battery compared with the start.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .. import campus as c
from ..simulator import Conditions, Policy, dispatch_setpoint, zone_loads

STEP_H = 0.5  # one decision every 30 minutes
STEPS = int(24 / STEP_H)
# Energy left in the battery is worth what it costs to put back off-peak (₹/kWh).
STORED_VALUE = lambda: c.TARIFF["off-peak"].rate / c.BATTERY_EFF  # noqa: E731
# The campus's own policy for loads: the agents' pre-cooling and HVAC scheduling.
LOAD_POLICY = Policy(ai=True, precool=True, hvac_trim=True)
# How far ahead the Forecaster's peak estimate looks (hours).
LOOKAHEAD_H = 6.0


@dataclass
class Day:
    hours: np.ndarray  # decision times
    net_kw: np.ndarray  # demand - solar at each decision time
    rate: np.ndarray  # ₹/kWh
    start_soc: float
    cond: Conditions
    label: str = ""


def make_day(rng: np.random.Generator, label: str = "") -> Day:
    heat = int(rng.choice([0, 0, 0, 0, 2, 3, 4]))
    cond = Conditions(
        demand_factor=float(rng.uniform(0.88, 1.12)),
        solar_factor=float(np.clip(rng.normal(0.92, 0.12), 0.35, 1.05)),
        temp_offset_c=float(rng.uniform(-3.0, 4.0)),
        heat_severity=heat,
    )
    return day_from_conditions(cond, float(rng.uniform(35, 85)), label)


def day_from_conditions(cond: Conditions, start_soc: float, label: str = "") -> Day:
    hours = np.arange(STEPS) * STEP_H
    net = np.empty(STEPS)
    for i, h in enumerate(hours):
        # average the 15-minute slot at 5-minute resolution, like the evaluation does
        vals = []
        for k in range(3):
            t = h + k * STEP_H / 3
            demand = sum(z.kw for z in zone_loads(t, cond, LOAD_POLICY))
            solar = cond.solar_and_temp(t)[0] * cond.solar_factor
            vals.append(demand - solar)
        net[i] = sum(vals) / 3
    rate = np.array([cond.rate(h) for h in hours])
    return Day(hours, net, rate, start_soc, cond, label)


def peak_ahead(net_kw: np.ndarray, i: int, lookahead_h: float = LOOKAHEAD_H) -> float:
    """Highest net load over the next few hours (what the Forecaster tells the Planner)."""
    j = min(len(net_kw), i + 1 + int(lookahead_h / STEP_H))
    return float(net_kw[i:j].max())


class DayEnv:
    """reset() -> state; step(setpoint_kw) -> (next state, reward, done). State = (hour, soc, net, max import, peak ahead)."""

    def __init__(self, day: Day, forecast_noise: float = 0.0, rng: np.random.Generator | None = None):
        self.day, self.noise, self.rng = day, forecast_noise, rng

    def state(self) -> tuple:
        ahead = peak_ahead(self.day.net_kw, self.i)
        if self.noise and self.rng is not None:
            ahead *= 1 + self.rng.normal(0, self.noise)  # the Forecaster is not perfect
        return (float(self.day.hours[self.i]), self.soc, float(self.day.net_kw[self.i]), self.max_import, ahead)

    def reset(self) -> tuple:
        self.i, self.soc, self.max_import, self.energy_cost = 0, self.day.start_soc, 0.0, 0.0
        self.idle_max, self.idle_cost = 0.0, 0.0
        self.trace = {"grid": [], "soc": [], "battery": []}
        return self.state()

    def step(self, setpoint_kw: float) -> tuple[tuple | None, float, bool]:
        d, i = self.day, self.i
        net = float(d.net_kw[i])
        b = dispatch_setpoint(setpoint_kw, self.soc, net, STEP_H, c.BATTERY_CAPACITY_KWH, c.BATTERY_FLOOR_PCT)
        g = net - b
        soc0 = self.soc
        if b > 0:
            self.soc -= b * STEP_H / c.BATTERY_EFF / c.BATTERY_CAPACITY_KWH * 100
        else:
            self.soc += -b * STEP_H * c.BATTERY_EFF / c.BATTERY_CAPACITY_KWH * 100
        cost = max(g, 0) * STEP_H * d.rate[i] + max(0.0, g - c.CONTRACT_LIMIT_KW) * STEP_H * c.EXCESS_PENALTY_INR_PER_KWH
        if g > self.max_import:
            cost += (g - self.max_import) * c.DEMAND_CHARGE_INR_PER_KW_DAY
            self.max_import = g
        self.energy_cost += cost
        # What the same 15 minutes would have cost with the battery idle (its own peak tracked too).
        idle = max(net, 0) * STEP_H * d.rate[i] + max(0.0, net - c.CONTRACT_LIMIT_KW) * STEP_H * c.EXCESS_PENALTY_INR_PER_KWH
        if net > self.idle_max:
            idle += (net - self.idle_max) * c.DEMAND_CHARGE_INR_PER_KW_DAY
            self.idle_max = net
        self.idle_cost += idle
        # Reward = money saved against an idle battery in this slot, with stored energy credited as it
        # changes. The day's total is (idle cost - agent cost): the same goal as "minimise the bill",
        # but without the day-to-day swings of the whole bill drowning out what the battery did.
        reward = idle - cost + (self.soc - soc0) / 100 * c.BATTERY_CAPACITY_KWH * STORED_VALUE()
        self.trace["grid"].append(g)
        self.trace["soc"].append(self.soc)
        self.trace["battery"].append(b)
        self.i += 1
        done = self.i >= len(d.hours)
        return (None if done else self.state()), reward, done


def run_day(day: Day, choose, forecast_noise: float = 0.0, rng: np.random.Generator | None = None) -> dict:
    """Plays one day with `choose(state) -> battery setpoint kW`. Returns the day's net cost and trajectory."""
    env = DayEnv(day, forecast_noise, rng)
    s, total, done = env.reset(), 0.0, False
    while not done:
        s, r, done = env.step(choose(s))
        total += r
    stored = (env.soc - day.start_soc) / 100 * c.BATTERY_CAPACITY_KWH * STORED_VALUE()
    return {"cost": env.energy_cost - stored, "savedInr": total, "energyCost": env.energy_cost, "maxImport": env.max_import,
            "endSoc": env.soc, **env.trace}
