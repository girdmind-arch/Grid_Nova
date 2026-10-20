"""Incident memory: what happened, what was done, and the lessons learned.

Starts with four incidents from earlier in the month (the campus's history) and
grows as scenarios run. In-memory: a restart starts from the history again.
"""

from __future__ import annotations

import threading

import numpy as np

HISTORY = {
    "incidents": [
        {"id": "INC-41", "occurredAt": "2026-05-11T14:05:00+05:30", "type": "cloud_cover", "title": "Sudden cloud cover",
         "cause": "Solar output fell from 640 kW to 210 kW in 9 minutes.",
         "action": "Battery covered the gap; library HVAC eased by 1°C.",
         "outcome": "No zone lost power. Extra cost ₹620.", "recoveryMin": 3},
        {"id": "INC-40", "occurredAt": "2026-05-08T19:32:00+05:30", "type": "line_failure", "title": "Feeder fault near GH1",
         "cause": "Cable joint failure on feeder F3.",
         "action": "Isolated GH1 and rerouted via feeder F2.",
         "outcome": "Power restored to 96% of the hostel in 6 minutes.", "recoveryMin": 6},
        {"id": "INC-38", "occurredAt": "2026-05-05T18:00:00+05:30", "type": "heatwave", "title": "Heatwave evening peak",
         "cause": "42°C day pushed demand 11% above forecast.",
         "action": "Pre-cooled hostels from 17:30 and discharged battery in the peak.",
         "outcome": "Peak import cut by 290 kW. Comfort stayed above 95%.", "recoveryMin": 0},
        {"id": "INC-35", "occurredAt": "2026-04-29T21:10:00+05:30", "type": "grid_outage", "title": "Main grid outage",
         "cause": "Upstream substation trip (UPPCL).",
         "action": "Islanded the campus on battery; hostels reduced to 60%.",
         "outcome": "Labs and library kept full power for 48 minutes.", "recoveryMin": 2},
    ],
    "lessons": [
        {"id": "L-12", "incidentId": "INC-41", "note": "Keep 15% battery headroom on partly cloudy afternoons.", "appliedCount": 3},
        {"id": "L-11", "incidentId": "INC-40", "note": "Pre-check feeder F2 capacity before evening rerouting.", "appliedCount": 1},
        {"id": "L-09", "incidentId": "INC-38", "note": "Start pre-cooling 30 minutes before peak when above 40°C.", "appliedCount": 4},
    ],
}


class Memory:
    def __init__(self):
        self._lock = threading.RLock()
        self.incidents: list[dict] = [dict(i) for i in HISTORY["incidents"]]
        self.lessons: list[dict] = [dict(l) for l in HISTORY["lessons"]]

    def snapshot(self) -> dict:
        with self._lock:
            incidents = sorted(self.incidents, key=lambda i: i["occurredAt"], reverse=True)
            return {"incidents": incidents, "lessons": list(self.lessons)}

    def lesson_for(self, fault_type: str) -> dict | None:
        """The most recent past incident of this type and its lesson, as `usedMemory`."""
        with self._lock:
            past = [i for i in self.incidents if i["type"] == fault_type]
            if not past:
                return None
            inc = max(past, key=lambda i: i["occurredAt"])
            lesson = next((l for l in self.lessons if l["incidentId"] == inc["id"]), None)
            summary = lesson["note"] if lesson else inc["outcome"]
            return {"incidentId": inc["id"], "summary": summary}

    def record(self, fault, decision: dict) -> None:
        """Stores a finished incident and updates lessons (new on run 1, reused afterwards)."""
        with self._lock:
            act = next((s["summary"] for s in decision["steps"] if s["kind"] == "act"), "")
            result = next((s["summary"] for s in decision["steps"] if s["kind"] == "result"), "")
            outcome = decision.get("outcome") or {}
            incident = {
                "id": fault.incident_id,
                "occurredAt": decision["startedAt"],
                "type": fault.type,
                "title": decision["title"],
                "cause": decision["trigger"],
                "action": act,
                "outcome": result,
                "recoveryMin": outcome.get("recoveryMin", 0),
            }
            self.incidents = [i for i in self.incidents if i["id"] != incident["id"]] + [incident]

            learned = outcome.get("lessonLearned")
            applied = outcome.get("lessonApplied")
            if learned and not any(l["note"] == learned for l in self.lessons):
                self.lessons.insert(0, {"id": f"L-{fault.incident_id}", "incidentId": fault.incident_id, "note": learned, "appliedCount": 0})
            elif applied:
                for l in self.lessons:
                    if l["note"] == applied:
                        l["appliedCount"] += 1


class PlanMemory:
    """The Critic's experience: which plan worked best in which situation.

    Each entry is a situation (severity, time of day, battery charge, temperature as numbers),
    the lever values of the best plan the Planner found there, and how well it scored. When a
    similar situation comes back, the closest entry seeds the Planner's search.
    """

    MAX_DISTANCE = 0.45  # how different a past situation may be and still count as "similar"

    def __init__(self):
        self._lock = threading.RLock()
        self.entries: list[dict] = []

    def recall(self, kind: str, features: np.ndarray) -> dict | None:
        with self._lock:
            best, dist = None, float("inf")
            for e in self.entries:
                if e["kind"] != kind:
                    continue
                d = float(np.linalg.norm(e["features"] - features))
                if d < dist:
                    best, dist = e, d
            if best is None or dist > self.MAX_DISTANCE:
                return None
            best["recalled"] += 1
            return {**best, "distance": dist}

    def store(self, kind: str, features: np.ndarray, params: dict, score: float, source: str, note: str) -> None:
        with self._lock:
            # Replace a near-identical memory only if the new plan scored better (keep the best experience).
            for e in self.entries:
                if e["kind"] == kind and float(np.linalg.norm(e["features"] - features)) < 0.05:
                    if score < e["score"]:
                        e.update(features=features, params=dict(params), score=score, source=source, note=note)
                    return
            self.entries.append({"kind": kind, "features": features, "params": dict(params), "score": score,
                                 "source": source, "note": note, "recalled": 0})
            del self.entries[:-200]

    def summary(self) -> list[dict]:
        with self._lock:
            return [{"kind": e["kind"], "source": e["source"], "note": e["note"], "recalled": e["recalled"]} for e in self.entries]
