"""The Planner's reinforcement-learning agent: tabular Q-learning (Monte Carlo control) over the battery.

What it sees (the state, every 15 minutes):
    hour of day · battery charge · net load now (demand minus solar) ·
    margin to today's highest import so far · the Forecaster's highest net load in the next 6 h
What it can do (the actions): charge the battery (200 or 400 kW), leave it idle, hold grid import at
today's peak so far, or discharge to shave the forecast peak by 100-800 kW. The caps are relative to
what the Forecaster expects, so one learned rule of thumb works on quiet days and busy days alike.
What it learns: Q(state, action) = expected money saved for the rest of the day, from thousands of
simulated days. Acting = taking the action with the best learned value (never a hand-written rule).
Physical and safety limits are not its job: the battery physics clamp every setpoint, and the
Guardrail agent checks every resulting plan in the digital twin before anything runs.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .env import DayEnv, make_day

# ("charge", kW) draws extra power into the battery; ("idle", 0) leaves it alone; ("hold", 0) discharges
# so grid import does not set a new peak for the day; ("shave", kW) discharges to keep grid import
# that far below the Forecaster's expected peak for the next 6 hours.
ACTIONS: list[tuple[str, float]] = [("charge", 400.0), ("charge", 200.0), ("idle", 0.0), ("hold", 0.0),
                                    ("shave", 100.0), ("shave", 200.0), ("shave", 350.0), ("shave", 500.0),
                                    ("shave", 650.0), ("shave", 800.0)]
IDLE = ACTIONS.index(("idle", 0.0))


def cap_kw(action: tuple[str, float], state: tuple) -> float | None:
    kind, kw = action
    _, _, _, max_import, ahead = state
    if kind == "hold":
        return max(max_import, 0.0)
    if kind == "shave":
        return max(0.0, ahead - kw)
    return None


def setpoint(action: tuple[str, float], state: tuple) -> float:
    kind, kw = action
    if kind == "charge":
        return -kw
    cap = cap_kw(action, state)
    return 0.0 if cap is None else max(0.0, state[2] - cap)


def describe(action: tuple[str, float], state: tuple) -> str:
    kind, kw = action
    if kind == "charge":
        return f"charge the battery at {round(kw):,} kW"
    cap = cap_kw(action, state)
    if kind == "hold":
        return f"hold grid import at today's peak so far ({round(cap):,} kW)"
    if kind == "shave":
        return f"shave {round(kw):,} kW off the forecast peak (cap grid import at {round(cap):,} kW)"
    return "leave the battery idle"

SOC_EDGES = [27.5, 35, 42.5, 50, 57.5, 65, 72.5, 80, 87.5]  # 10 buckets over 20-90%
NET_EDGES = [300, 600, 900, 1100, 1300, 1500]  # 7 buckets
MARGIN_EDGES = [-150, 0, 150]  # today's peak so far minus net load: 4 buckets
AHEAD_EDGES = [900, 1100, 1300, 1500]  # Forecaster's peak in the next 6 h: 5 buckets
SHAPE = (24, len(SOC_EDGES) + 1, len(NET_EDGES) + 1, len(MARGIN_EDGES) + 1, len(AHEAD_EDGES) + 1, len(ACTIONS))


def encode(state: tuple) -> tuple[int, int, int, int, int]:
    hour, soc, net, max_import, ahead = state
    return (
        int(hour) % 24,
        int(np.searchsorted(SOC_EDGES, soc)),
        int(np.searchsorted(NET_EDGES, net)),
        int(np.searchsorted(MARGIN_EDGES, max_import - net)),
        int(np.searchsorted(AHEAD_EDGES, ahead)),
    )


class QAgent:
    def __init__(self, q: np.ndarray | None = None, visits: np.ndarray | None = None):
        self.q = np.zeros(SHAPE) if q is None else q
        self.visits = np.zeros(SHAPE, dtype=np.int32) if visits is None else visits

    # ---------- acting ----------
    def values(self, state: tuple) -> np.ndarray:
        return self.q[encode(state)]

    def best_action(self, state: tuple) -> int:
        vals = self.values(state)
        seen = self.visits[encode(state)] > 0
        if not seen.any():
            return IDLE  # never visited in training: do nothing rather than guess
        vals = np.where(seen, vals, -np.inf)
        return int(np.argmax(vals))

    def act(self, state: tuple) -> float:
        """Battery setpoint (kW, + discharge) for a state."""
        return setpoint(ACTIONS[self.best_action(state)], state)

    def explain(self, state: tuple) -> dict:
        """The learned values behind one decision, for the thought trace."""
        vals = self.values(state)
        a = self.best_action(state)
        idle = IDLE
        return {
            "action": describe(ACTIONS[a], state),
            "setpointKw": round(setpoint(ACTIONS[a], state)),
            "valueInr": round(float(vals[a])),
            "idleValueInr": round(float(vals[idle])),
            "advantageInr": round(float(vals[a] - vals[idle])),
            "visits": int(self.visits[encode(state)][a]),
        }

    def controller(self, ahead_fn, peak_so_far: float = 0.0):
        """A battery controller for the simulator: (hour, soc, net, max import) -> setpoint kW.

        `ahead_fn(hour, net_now)` is the Forecaster's highest net load over the next 6 hours, and
        `peak_so_far` today's highest import before the simulation started (a twin run starts
        mid-day with fresh totals, but the demand charge remembers the whole day).
        """
        def control(hour: float, soc: float, net: float, max_import: float) -> float:
            return self.act((hour, soc, net, max(max_import, peak_so_far), ahead_fn(hour, net)))

        return control

    # ---------- learning ----------
    def train(self, episodes: int, seed: int = 0, forecast_noise: float = 0.04, report_every: int = 500,
              eps_start: float = 1.0, eps_end: float = 0.03) -> list[dict]:
        """Q-learning with epsilon-greedy exploration on freshly generated days. Returns the learning curve."""
        rng = np.random.default_rng(seed)
        days = [make_day(rng) for _ in range(min(episodes, 400))]  # a pool of days, reused with new noise
        curve, window = [], []
        for ep in range(episodes):
            eps = eps_end + (eps_start - eps_end) * max(0.0, 1 - ep / (0.8 * episodes))
            env = DayEnv(days[ep % len(days)], forecast_noise, rng)
            s, done, total = env.reset(), False, 0.0
            k = encode(s)
            episode: list[tuple[tuple, int, float]] = []
            while not done:
                a = int(rng.integers(len(ACTIONS))) if rng.random() < eps else self._greedy(k)
                s2, r, done = env.step(setpoint(ACTIONS[a], s))
                total += r
                episode.append((k, a, r))
                if not done:
                    k, s = encode(s2), s2
            # Learn from the whole day at once: each decision is credited with the money actually
            # saved from that moment to midnight (Monte Carlo returns, no guessing from estimates).
            # The demand charge is decided hours later in the evening peak, which is exactly the kind
            # of delayed consequence this credits correctly.
            ret = 0.0
            for k_, a_, r_ in reversed(episode):
                ret += r_
                self.visits[k_][a_] += 1
                alpha = max(0.01, 1.0 / self.visits[k_][a_])
                self.q[k_][a_] += alpha * (ret - self.q[k_][a_])
            window.append(total)
            if (ep + 1) % report_every == 0:
                curve.append({"episode": ep + 1, "avgSavedInr": round(float(np.mean(window))), "epsilon": round(eps, 3)})
                window = []
        return curve

    def _greedy(self, k) -> int:
        seen = self.visits[k] > 0
        if not seen.any():
            return IDLE
        return int(np.argmax(np.where(seen, self.q[k], -np.inf)))

    def _max(self, k) -> float:
        seen = self.visits[k] > 0
        return float(self.q[k][seen].max()) if seen.any() else 0.0

    # ---------- persistence ----------
    def save(self, path: Path) -> None:
        """Saves the learned policy compactly: for each state the agent visited, its best action with that
        action's value and visit count, plus the value of leaving the battery idle (for explanations).
        Acting from this is identical to acting from the full table (the best action is still the argmax)."""
        states = np.argwhere(self.visits.sum(axis=-1) > 0)
        flat, acts, qb, qi, nb = [], [], [], [], []
        for st in states:
            k = tuple(st)
            a = self._greedy(k)
            flat.append(int(np.ravel_multi_index(k, SHAPE[:-1])))
            acts.append(str(a))
            qb.append(round(float(self.q[k][a])))
            qi.append(round(float(self.q[k][IDLE])) if self.visits[k][IDLE] > 0 else None)
            nb.append(int(self.visits[k][a]))
        deltas = [flat[0]] + [b - a for a, b in zip(flat, flat[1:])] if flat else []
        path.write_text(json.dumps({
            "format": "greedy-v1", "shape": list(SHAPE), "actions": [list(a) for a in ACTIONS],
            "stateDeltas": deltas, "best": "".join(acts), "qBest": qb, "qIdle": qi, "visits": nb,
        }, separators=(",", ":")))

    @classmethod
    def load(cls, path: Path) -> "QAgent":
        d = json.loads(path.read_text())
        if tuple(d["shape"]) != SHAPE or [tuple(a) for a in d["actions"]] != ACTIONS:
            raise ValueError("saved Q-table does not match this agent's state/action space; retrain")
        agent = cls()
        if d.get("format") == "greedy-v1":
            flat = np.cumsum(d["stateDeltas"]) if d["stateDeltas"] else []
            for f, a, qb, qi, n in zip(flat, d["best"], d["qBest"], d["qIdle"], d["visits"]):
                k = np.unravel_index(int(f), SHAPE[:-1])
                a = int(a)
                agent.q[k][a], agent.visits[k][a] = qb, max(1, n)
                if qi is not None and a != IDLE:
                    agent.q[k][IDLE], agent.visits[k][IDLE] = qi, 1
            return agent
        for i, q, n in zip(d["idx"], d["q"], d["n"]):  # older full-table format
            agent.q[tuple(i)] = q
            agent.visits[tuple(i)] = n
        return agent
