# hi
"""The simulated campus: buildings, feeders, battery, tariff and daily profiles.

A mid-sized Indian campus on a hot May weekday. Numbers are illustrative but
chosen to be realistic (UPPCL-style time-of-day tariff, evening peak
18:00-22:00, a ~720 kW rooftop solar array, a 2 MWh battery).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ZoneSpec:
    id: str
    name: str
    kind: str  # hostel | lab | library | admin | academic | residence
    priority: str  # critical | high | normal
    feeder: str
    # Share of total campus demand (no-AI baseline) this building draws.
    share: float


# Demand at 17:20 split across buildings (still 1,240 kW in total):
# hostels 150+138+128+116, labs 196+164, library 100, lecture theatres 70,
# admin 82, faculty compound 96.
_KW_1720 = {
    "hostel-bh1": 150,
    "hostel-bh2": 138,
    "hostel-gh1": 128,
    "hostel-gh2": 116,
    "lab-electrical": 196,
    "lab-cs": 164,
    "library": 100,
    "lecture-theatres": 70,
    "admin": 82,
    "faculty-compound": 96,
}
_TOTAL_1720 = sum(_KW_1720.values())

ZONES: list[ZoneSpec] = [
    ZoneSpec("hostel-bh1", "BH1", "hostel", "normal", "F1", _KW_1720["hostel-bh1"] / _TOTAL_1720),
    ZoneSpec("hostel-bh2", "BH2", "hostel", "normal", "F1", _KW_1720["hostel-bh2"] / _TOTAL_1720),
    ZoneSpec("hostel-gh1", "GH1", "hostel", "normal", "F3", _KW_1720["hostel-gh1"] / _TOTAL_1720),
    ZoneSpec("hostel-gh2", "GH2", "hostel", "normal", "F2", _KW_1720["hostel-gh2"] / _TOTAL_1720),
    ZoneSpec("lab-electrical", "Electrical Lab", "lab", "critical", "F4", _KW_1720["lab-electrical"] / _TOTAL_1720),
    ZoneSpec("lab-cs", "Computer Science Lab", "lab", "critical", "F4", _KW_1720["lab-cs"] / _TOTAL_1720),
    ZoneSpec("library", "Central Library", "library", "high", "F2", _KW_1720["library"] / _TOTAL_1720),
    ZoneSpec("lecture-theatres", "Lecture Theatres", "academic", "high", "F5", _KW_1720["lecture-theatres"] / _TOTAL_1720),
    ZoneSpec("admin", "Admin Block", "admin", "high", "F5", _KW_1720["admin"] / _TOTAL_1720),
    ZoneSpec("faculty-compound", "Faculty Compound", "residence", "normal", "F6", _KW_1720["faculty-compound"] / _TOTAL_1720),
]
ZONE_BY_ID = {z.id: z for z in ZONES}

# Feeder ratings (kW). Guardrail G3 keeps every feeder at or below 90%.
FEEDER_RATING_KW = {"F1": 520, "F2": 430, "F3": 260, "F4": 700, "F5": 300, "F6": 220}
FEEDER_LIMIT = 0.9

# Battery: 2 MWh, usable window 20-90% (Guardrail G2).
BATTERY_CAPACITY_KWH = 2000.0
BATTERY_MAX_KW = 1500.0  # inverter rating (enough to island the campus)
BATTERY_FLOOR_PCT = 20.0
BATTERY_CEIL_PCT = 90.0
# One-way efficiency (round trip ~92%).
BATTERY_EFF = 0.96

# Grid connection.
CONTRACT_LIMIT_KW = 1600.0  # Guardrail G4
# Demand charge on the day's highest grid import (₹ per kW per day, ~₹360/kW-month).
DEMAND_CHARGE_INR_PER_KW_DAY = 12.0
# Penalty per kWh imported above the contract limit.
EXCESS_PENALTY_INR_PER_KWH = 15.0


@dataclass(frozen=True)
class TariffSlab:
    slab: str
    rate: float
    label: str


TARIFF = {
    "off-peak": TariffSlab("off-peak", 6.90, "Off-peak · 22:00–06:00"),
    "normal": TariffSlab("normal", 8.25, "Normal · 06:00–18:00"),
    "peak": TariffSlab("peak", 9.70, "Peak · 18:00–22:00"),
}


def set_tariff(off_peak: float, normal: float, peak: float) -> None:
    """Switches the time-of-day rates (e.g. when the campus moves to another state)."""
    TARIFF["off-peak"] = TariffSlab("off-peak", off_peak, "Off-peak · 22:00–06:00")
    TARIFF["normal"] = TariffSlab("normal", normal, "Normal · 06:00–18:00")
    TARIFF["peak"] = TariffSlab("peak", peak, "Peak · 18:00–22:00")


def tariff_key() -> tuple[float, float, float]:
    return TARIFF["off-peak"].rate, TARIFF["normal"].rate, TARIFF["peak"].rate


def tariff_at(hour: float) -> TariffSlab:
    h = hour % 24
    if 18 <= h < 22:
        return TARIFF["peak"]
    if 6 <= h < 18:
        return TARIFF["normal"]
    return TARIFF["off-peak"]


# Hourly campus demand (kW, no-AI baseline) and clear-sky solar (kW) for a hot weekday.
HOURLY_DEMAND_KW = [
    610, 580, 560, 550, 560, 620, 760, 900, 1010, 1080, 1120, 1150,
    1170, 1160, 1140, 1150, 1190, 1240, 1420, 1510, 1480, 1390, 1120, 820,
]
HOURLY_SOLAR_KW = [
    0, 0, 0, 0, 0, 0, 20, 130, 300, 470, 610, 690,
    720, 700, 630, 520, 400, 260, 90, 10, 0, 0, 0, 0,
]


def _interp(series: list[float], hour: float) -> float:
    """Linear interpolation of an hourly series, treating values as on the hour."""
    h = hour % 24
    i = int(h)
    frac = h - i
    a = series[i]
    b = series[(i + 1) % 24]
    return a + (b - a) * frac


def campus_demand_kw(hour: float) -> float:
    return _interp(HOURLY_DEMAND_KW, hour)


def clear_sky_solar_kw(hour: float) -> float:
    return _interp(HOURLY_SOLAR_KW, hour)


def zone_baseline_kw(zone: ZoneSpec, hour: float) -> float:
    """A building's no-AI demand at a given hour (its share of the campus profile)."""
    return zone.share * campus_demand_kw(hour)
