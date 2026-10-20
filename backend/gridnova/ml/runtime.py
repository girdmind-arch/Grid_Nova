"""Loads the trained models once for the running server (see train.py to make them).

If a model file is missing or does not match the code, the agents fall back to their
non-learned behaviour and say so (the Forecaster uses a typical-day profile, the Planner
leaves the learned battery policy out of its search).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from .forecaster import LearnedForecaster
from .nn import MLP
from .qagent import QAgent

log = logging.getLogger("gridnova.ml")
MODELS = Path(__file__).parent / "models"


def _load():
    fc = q = None
    metrics: dict = {}
    try:
        fc = LearnedForecaster(MLP.load(MODELS / "forecaster.json"))
    except Exception as e:  # noqa: BLE001 - a missing model must never stop the server
        log.warning("learned forecaster not available: %s", e)
    try:
        q = QAgent.load(MODELS / "planner_q.json")
    except Exception as e:  # noqa: BLE001
        log.warning("learned planner policy not available: %s", e)
    try:
        metrics = json.loads((MODELS / "metrics.json").read_text())
    except Exception:  # noqa: BLE001
        metrics = {}
    return fc, q, metrics


FORECASTER, PLANNER_Q, METRICS = _load()
