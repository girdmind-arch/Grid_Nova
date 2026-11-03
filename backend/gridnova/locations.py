# hi
"""Campus locations anywhere in India: place search and state-wise tariffs.

Place search uses Open-Meteo's free geocoding API (limited to India), with a
built-in list of major cities as a fallback when it can't be reached.

Each state has its own DISCOM and time-of-day (ToD) tariff. The rates below are
ILLUSTRATIVE commercial ToD rates for the simulation, not official figures:
check the state's latest tariff order before quoting them.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass

log = logging.getLogger("gridnova.locations")

GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search"


@dataclass(frozen=True)
class StateTariff:
    discom: str
    off_peak: float  # 22:00-06:00
    normal: float  # 06:00-18:00
    peak: float  # 18:00-22:00


# Illustrative ToD rates (₹/kWh) by state / UT.
STATE_TARIFFS: dict[str, StateTariff] = {
    "Uttar Pradesh": StateTariff("UPPCL", 6.90, 8.25, 9.70),
    "Delhi": StateTariff("BSES / Tata Power-DDL", 6.50, 7.80, 9.40),
    "Maharashtra": StateTariff("MSEDCL", 7.50, 9.00, 10.60),
    "Karnataka": StateTariff("BESCOM", 7.00, 8.30, 9.60),
    "Tamil Nadu": StateTariff("TNPDCL", 6.80, 8.00, 9.60),
    "Telangana": StateTariff("TGSPDCL", 7.00, 8.40, 9.80),
    "Andhra Pradesh": StateTariff("APEPDCL", 6.90, 8.20, 9.70),
    "Kerala": StateTariff("KSEB", 6.60, 7.90, 9.50),
    "Gujarat": StateTariff("UGVCL / MGVCL", 6.20, 7.40, 8.90),
    "Rajasthan": StateTariff("JVVNL", 7.20, 8.60, 10.30),
    "Punjab": StateTariff("PSPCL", 6.40, 7.60, 9.10),
    "Haryana": StateTariff("DHBVN / UHBVN", 6.70, 8.00, 9.50),
    "Chandigarh": StateTariff("Chandigarh Power", 5.80, 6.90, 8.30),
    "Madhya Pradesh": StateTariff("MPPKVVCL", 6.80, 8.10, 9.60),
    "Chhattisgarh": StateTariff("CSPDCL", 6.30, 7.50, 9.00),
    "Bihar": StateTariff("SBPDCL / NBPDCL", 7.10, 8.50, 10.10),
    "Jharkhand": StateTariff("JBVNL", 6.60, 7.90, 9.40),
    "Odisha": StateTariff("TPCODL", 6.20, 7.40, 8.80),
    "West Bengal": StateTariff("WBSEDCL / CESC", 7.30, 8.70, 10.20),
    "Assam": StateTariff("APDCL", 7.00, 8.30, 9.90),
    "Meghalaya": StateTariff("MePDCL", 6.40, 7.60, 9.10),
    "Uttarakhand": StateTariff("UPCL", 5.90, 7.00, 8.40),
    "Himachal Pradesh": StateTariff("HPSEBL", 5.60, 6.70, 8.00),
    "Jammu and Kashmir": StateTariff("JPDCL / KPDCL", 5.40, 6.40, 7.70),
    "Goa": StateTariff("Goa Electricity Department", 5.80, 6.90, 8.20),
}
DEFAULT_TARIFF = StateTariff("State DISCOM", 6.90, 8.25, 9.70)


def tariff_for(state: str | None) -> StateTariff:
    return STATE_TARIFFS.get((state or "").strip(), DEFAULT_TARIFF)


@dataclass(frozen=True)
class Place:
    name: str
    state: str
    lat: float
    lon: float

    def to_json(self) -> dict:
        t = tariff_for(self.state)
        return {**asdict(self), "discom": t.discom, "tariff": {"offPeak": t.off_peak, "normal": t.normal, "peak": t.peak}}


# Built-in fallback list (also the suggestions shown before typing).
CITIES: list[Place] = [
    Place("Lucknow", "Uttar Pradesh", 26.85, 80.95),
    Place("Kanpur", "Uttar Pradesh", 26.45, 80.33),
    Place("New Delhi", "Delhi", 28.61, 77.21),
    Place("Mumbai", "Maharashtra", 19.08, 72.88),
    Place("Pune", "Maharashtra", 18.52, 73.86),
    Place("Nagpur", "Maharashtra", 21.15, 79.09),
    Place("Bengaluru", "Karnataka", 12.97, 77.59),
    Place("Chennai", "Tamil Nadu", 13.08, 80.27),
    Place("Coimbatore", "Tamil Nadu", 11.02, 76.96),
    Place("Hyderabad", "Telangana", 17.39, 78.49),
    Place("Visakhapatnam", "Andhra Pradesh", 17.69, 83.22),
    Place("Kochi", "Kerala", 9.93, 76.27),
    Place("Thiruvananthapuram", "Kerala", 8.52, 76.94),
    Place("Ahmedabad", "Gujarat", 23.02, 72.57),
    Place("Jaipur", "Rajasthan", 26.91, 75.79),
    Place("Pilani", "Rajasthan", 28.37, 75.60),
    Place("Chandigarh", "Chandigarh", 30.73, 76.78),
    Place("Bhopal", "Madhya Pradesh", 23.26, 77.41),
    Place("Indore", "Madhya Pradesh", 22.72, 75.86),
    Place("Raipur", "Chhattisgarh", 21.25, 81.63),
    Place("Patna", "Bihar", 25.59, 85.14),
    Place("Ranchi", "Jharkhand", 23.34, 85.31),
    Place("Bhubaneswar", "Odisha", 20.30, 85.82),
    Place("Kolkata", "West Bengal", 22.57, 88.36),
    Place("Guwahati", "Assam", 26.14, 91.74),
    Place("Shillong", "Meghalaya", 25.58, 91.89),
    Place("Dehradun", "Uttarakhand", 30.32, 78.03),
    Place("Shimla", "Himachal Pradesh", 31.10, 77.17),
    Place("Srinagar", "Jammu and Kashmir", 34.08, 74.80),
    Place("Panaji", "Goa", 15.49, 73.83),
]


def search(query: str, limit: int = 8) -> tuple[list[Place], str]:
    """Places in India matching the query, and where they came from ("open-meteo" or "built-in")."""
    q = query.strip()
    if len(q) < 2:
        return CITIES[:limit], "built-in"
    params = {"name": q, "count": limit, "language": "en", "format": "json", "countryCode": "IN"}
    try:
        if os.environ.get("GRIDNOVA_OFFLINE") == "1":
            raise RuntimeError("offline mode")
        with urllib.request.urlopen(f"{GEOCODE_API}?{urllib.parse.urlencode(params)}", timeout=6) as r:
            data = json.load(r)
        out = [
            Place(x["name"], x.get("admin1") or "", round(float(x["latitude"]), 4), round(float(x["longitude"]), 4))
            for x in data.get("results", [])
            if x.get("country_code", "IN") == "IN"
        ]
        return out, "open-meteo"
    except Exception as e:
        log.warning("place search failed (%s); using built-in list", e)
        ql = q.lower()
        hits = [p for p in CITIES if ql in p.name.lower() or ql in p.state.lower()]
        return hits[:limit], "built-in"
