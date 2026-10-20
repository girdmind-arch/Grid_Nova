"""The Forecaster's learned model: campus demand for each of the next 12 hours.

A neural network (gridnova.ml.nn.MLP) trained on simulated campus history. It is not told the
load model's formulas: it sees what a forecaster would have at the time —

    the time of day, how busy the campus is right now compared with a typical day,
    the temperature now and the weather forecast's temperature for each of the next 12 hours

— and learns to predict the demand that actually followed. The training history includes
day-to-day variation the network cannot see directly (busier and quieter days, heatwaves) plus
random noise on every meter reading, so it has to learn patterns, not copy a formula.

On the live campus it keeps learning: every hour the actual demand is compared with what it
predicted 1-12 hours earlier and the network takes a few small gradient steps on those examples.
"""

from __future__ import annotations

import math
from collections import deque

import numpy as np

from .. import campus as c
from ..simulator import Conditions, zone_loads
from .nn import MLP

HORIZON = 12
METER_NOISE = 0.03  # ±3% random variation on each hourly reading (sensor noise, occupancy)


def features(hour: float, demand_now: float, temp_now: float, temps_ahead: list[float]) -> np.ndarray:
    profile_now = c.campus_demand_kw(hour)
    return np.array([
        math.sin(2 * math.pi * hour / 24), math.cos(2 * math.pi * hour / 24),
        demand_now / profile_now, temp_now, *temps_ahead[:HORIZON],
    ])


def _demand(cond: Conditions, hour: float, pol) -> float:
    return sum(z.kw for z in zone_loads(hour, cond, pol))


def history(days: int, seed: int) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Simulated history: one example per issue hour. Returns X, Y (kW) and the raw rows for baselines."""
    from .env import LOAD_POLICY

    rng = np.random.default_rng(seed)
    X, Y, rows = [], [], []
    for _ in range(days):
        cond = Conditions(
            demand_factor=float(rng.uniform(0.88, 1.12)),
            temp_offset_c=float(rng.uniform(-4.0, 5.0)),
            heat_severity=int(rng.choice([0, 0, 0, 0, 0, 2, 3, 4])),
        )
        # 36 hours of hourly readings so every issue hour has 12 hours of "future"
        noise = 1 + METER_NOISE * rng.standard_normal(36)
        demand = np.array([_demand(cond, h, LOAD_POLICY) for h in range(36)]) * noise
        temps = [cond.solar_and_temp(h)[1] for h in range(37)]
        for t in range(24):
            X.append(features(t, demand[t], temps[t], temps[t + 1:t + 1 + HORIZON]))
            Y.append(demand[t + 1:t + 1 + HORIZON])
            rows.append({"hour": t, "demand_now": demand[t]})
    return np.array(X), np.array(Y), rows


def baselines(rows: list[dict], Y: np.ndarray) -> dict:
    """Mean absolute error (kW) of two simple forecasts, for comparison with the network."""
    profile = np.array([[c.campus_demand_kw(r["hour"] + k + 1) for k in range(HORIZON)] for r in rows])
    persistence = np.array([[r["demand_now"]] * HORIZON for r in rows])
    return {
        "typicalDayProfile": float(np.mean(np.abs(profile - Y))),
        "sameAsNow": float(np.mean(np.abs(persistence - Y))),
    }


class LearnedForecaster:
    def __init__(self, net: MLP):
        self.net = net
        self.buffer: deque[tuple[np.ndarray, np.ndarray]] = deque(maxlen=24 * 7)
        self.pending: dict[int, np.ndarray] = {}  # issue hour index -> features, waiting for actuals
        self.observed: dict[int, float] = {}
        self.online_updates = 0
        self.live_errors: deque[float] = deque(maxlen=48)

    def predict(self, hour: float, demand_now: float, temp_now: float, temps_ahead: list[float]) -> np.ndarray:
        return self.net.predict(features(hour, demand_now, temp_now, temps_ahead))[0]

    # ---------- learning on the live campus ----------
    def observe(self, abs_hour: int, demand_kw: float, temp_now: float, temps_ahead: list[float]) -> None:
        """Called once per hour with the actual demand. Learns from forecasts that can now be checked."""
        self.observed[abs_hour] = demand_kw
        self.pending[abs_hour] = features(abs_hour % 24, demand_kw, temp_now, temps_ahead)
        for issued, x in list(self.pending.items()):
            if issued + HORIZON <= abs_hour:  # all 12 actuals known
                y = np.array([self.observed.get(issued + k + 1, np.nan) for k in range(HORIZON)])
                del self.pending[issued]
                if np.isnan(y).any():
                    continue
                err = float(np.mean(np.abs(self.net.predict(x)[0] - y)))
                self.live_errors.append(err)
                self.buffer.append((x, y))
                self._learn()
        for h in [h for h in self.observed if h < abs_hour - 2 * HORIZON]:
            del self.observed[h]

    def _learn(self, steps: int = 8, lr: float = 1e-3) -> None:
        if len(self.buffer) < 4:
            return
        X = np.array([x for x, _ in self.buffer])
        Y = np.array([y for _, y in self.buffer])
        self.net.sgd(X, Y, steps=steps, lr=lr)
        self.online_updates += 1


# ---------- what the other agents ask the Forecaster ----------
def temps_ahead(cond: Conditions, hour: float) -> list[float]:
    return [cond.solar_and_temp(hour + k + 1)[1] for k in range(HORIZON)]


def demand_forecast(model: "LearnedForecaster | None", cond: Conditions, hour: float, demand_now: float) -> list[tuple[float, float]]:
    """(hour, predicted campus demand kW) for each of the next 12 whole hours."""
    base = math.floor(hour)
    if model is not None:
        demand = model.predict(base, demand_now, cond.solar_and_temp(base)[1], temps_ahead(cond, base))
    else:  # no trained model: a typical day, scaled to how busy the campus is now
        ratio = demand_now / c.campus_demand_kw(hour)
        demand = [c.campus_demand_kw(base + k + 1) * ratio for k in range(HORIZON)]
    return [(float(base + k + 1), float(demand[k])) for k in range(HORIZON)]


def net_forecast(model: "LearnedForecaster | None", cond: Conditions, hour: float, demand_now: float) -> list[tuple[float, float]]:
    """(hour, predicted net load kW) for the next 12 hours: learned demand minus the weather's solar."""
    out = [(hour, demand_now - cond.solar_and_temp(hour)[0] * cond.solar_factor)]
    for h, kw in demand_forecast(model, cond, hour, demand_now):
        out.append((h, kw - cond.solar_and_temp(h)[0] * cond.solar_factor))
    return out


def ahead_fn(points: list[tuple[float, float]], lookahead_h: float = 6.0):
    """The Planner's view of the forecast: highest predicted net load in the next `lookahead_h` hours."""
    last = points[-1][0]

    def ahead(hour: float, net_now: float | None = None) -> float:
        # hours are on the sim clock (may run past 24); beyond the forecast, the last value holds
        if hour < points[0][0] - 1:
            hour += 24  # the live clock wrapped past midnight since the forecast was made
        h = min(hour, last)
        vals = [kw for t, kw in points if h - 1 < t <= h + lookahead_h]
        return max(vals) if vals else points[-1][1]

    return ahead


def rolling_ahead(model: "LearnedForecaster | None", cond: Conditions, lookahead_h: float = 6.0):
    """Like ahead_fn, but the Forecaster re-forecasts every hour from what the meters show then."""
    cache: dict[int, object] = {}

    def ahead(hour: float, net_now: float) -> float:
        key = math.floor(hour)
        if key not in cache:
            demand_now = net_now + cond.solar_and_temp(hour)[0] * cond.solar_factor
            cache[key] = ahead_fn(net_forecast(model, cond, hour, demand_now), lookahead_h)
        return cache[key](hour)

    return ahead
