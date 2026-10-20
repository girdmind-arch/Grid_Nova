"""The Forecaster: the next 12 hours of demand, solar, temperature and tariff, plus events.

Solar and temperature come from the live weather forecast (Open-Meteo). Demand is predicted
by the Forecaster's own neural network (ml/forecaster.py), trained on simulated campus history
and updated online from the meters; the first point is the measured demand now.
"""

from __future__ import annotations

import math

from . import campus as c
from .grid import LiveGrid, iso
from .simulator import zone_loads


def _hhmm(hour: float) -> str:
    total = int(round(hour * 60)) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def build_forecast(grid: LiveGrid) -> dict:
    now = grid.hour()
    cond = grid.conditions()
    pol = grid.active_policy()
    start = math.floor(now)

    def solar_at(h: float) -> float:
        return cond.solar_and_temp(h)[0] * cond.solar_factor

    from .ml import runtime
    from .ml.forecaster import demand_forecast

    now_kw = grid.snapshot().demand_kw
    learned = dict(demand_forecast(runtime.FORECASTER, grid.conditions(None), now, now_kw))
    if grid.fault and grid.fault.type == "heatwave":
        # The model has never seen this scenario's extra load: scale by what the meters show now.
        expected_now = sum(z.kw for z in zone_loads(now, grid.conditions(None), pol))
        learned = {h: kw * now_kw / max(expected_now, 1.0) for h, kw in learned.items()}
    points = []
    for i in range(12):
        h = start + i
        demand = now_kw if i == 0 else learned.get(float(h), sum(z.kw for z in zone_loads(h, cond, pol)))
        points.append({
            "time": iso(grid.at(h)),
            "demandKw": round(demand),
            "solarKw": round(solar_at(h)),
            "tariffInr": cond.rate(h),
            "temperatureC": round(cond.solar_and_temp(h)[1], 1),
        })

    events = []
    # Next two tariff changes.
    for i in range(1, 25):
        h = start + i
        if c.tariff_at(h).slab != c.tariff_at(h - 1).slab and h > now:
            t = c.tariff_at(h)
            rate = cond.rate(h)
            title = {"peak": "Evening peak begins", "off-peak": "Off-peak tariff", "normal": "Normal tariff"}[t.slab]
            detail = {
                "peak": f"Tariff rises to ₹{rate:.2f}/kWh until 22:00.",
                "off-peak": f"Recharge battery at ₹{rate:.2f}/kWh overnight.",
                "normal": f"Tariff ₹{rate:.2f}/kWh until 18:00.",
            }[t.slab]
            events.append({"id": f"ev-tariff-{h}", "time": iso(grid.at(h)), "title": title, "detail": detail, "kind": "tariff"})
            if sum(e["kind"] == "tariff" for e in events) >= 2:
                break

    # Sunset / sunrise for solar, searched in 10-minute steps.
    t, step = now, 1 / 6
    producing = solar_at(now) >= 100
    while t < now + 12:
        if producing and solar_at(t) < 100:
            events.append({"id": "ev-solar", "time": iso(grid.at(t)), "title": "Solar output drops below 100 kW",
                           "detail": "Battery and grid take over as the sun sets.", "kind": "solar"})
            break
        if not producing and solar_at(t) >= 100:
            events.append({"id": "ev-solar", "time": iso(grid.at(t)), "title": "Solar passes 100 kW",
                           "detail": "Morning sun starts covering part of the campus load.", "kind": "solar"})
            break
        t += step

    mae = round(runtime.METRICS.get("forecaster", {}).get("maeKw", 0)) or "?"
    # Demand peak in the window.
    peak = max(points, key=lambda p: p["demandKw"])
    if peak["demandKw"] > points[0]["demandKw"] + 20:
        events.append({"id": "ev-peak", "time": peak["time"], "title": "Campus demand peaks",
                       "detail": f"Forecast {peak['demandKw']:,} kW (±{mae} kW, learned model).", "kind": "peak"})

    # Weather worth knowing about: the hottest hour and heavy cloud during daylight.
    hottest = max(points, key=lambda p: p["temperatureC"])
    if hottest["temperatureC"] >= 38:
        events.append({"id": "ev-heat", "time": hottest["time"], "title": f"Hottest hour: {hottest['temperatureC']:.0f}°C",
                       "detail": "Cooling demand is highest; hostels may be pre-cooled.", "kind": "weather"})
    for i in range(12):
        h = start + i
        _, _, cloud, live = grid.weather.at(grid.at(h))
        if live and cloud >= 70 and c.clear_sky_solar_kw(h) > 150:
            events.append({"id": "ev-cloud", "time": iso(grid.at(h)), "title": f"Heavy cloud ({round(cloud)}%)",
                           "detail": "Solar output will be well below a clear day.", "kind": "weather"})
            break

    if grid.fault and grid.fault.type in ("cloud_cover", "heatwave"):
        end = grid.fault.started_hour + grid.fault.duration_min / 60
        label = "Clouds expected to clear" if grid.fault.type == "cloud_cover" else "Heat expected to ease"
        events.append({"id": "ev-scenario", "time": iso(grid.at(end)), "title": label,
                       "detail": f"About {_hhmm(end)}, based on the scenario duration.", "kind": "weather"})

    events.sort(key=lambda e: e["time"])
    model = None
    if runtime.FORECASTER is not None:
        f = runtime.METRICS.get("forecaster", {})
        model = {"name": "GridNova Forecaster (neural network)", "maeKw": f.get("maeKw"),
                 "baselineMaeKw": f.get("baselineMaeKw", {}).get("typicalDayProfile"), "onlineUpdates": runtime.FORECASTER.online_updates}
    return {"generatedAt": iso(grid.at(now)), "horizonHours": 12, "points": points, "events": events, "model": model}
