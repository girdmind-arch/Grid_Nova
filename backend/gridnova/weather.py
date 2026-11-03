# hi
"""Live weather for the campus from Open-Meteo (free, no API key).

Every 15 minutes the backend fetches hourly temperature, solar irradiance (GHI)
and cloud cover for the campus location. Solar output and cooling demand are
computed from it. If the fetch fails (no internet, API down), it falls back to
a typical hot-May profile and says so in `status()`.

Location defaults to Lucknow (UPPCL service area); override with CAMPUS_LAT,
CAMPUS_LON and CAMPUS_NAME.
"""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from . import campus as c

log = logging.getLogger("gridnova.weather")

IST = timezone(timedelta(hours=5, minutes=30))
LAT = float(os.environ.get("CAMPUS_LAT", "26.85"))
LON = float(os.environ.get("CAMPUS_LON", "80.95"))
NAME = os.environ.get("CAMPUS_NAME", "Lucknow")
STATE = os.environ.get("CAMPUS_STATE", "Uttar Pradesh")
REFRESH_S = 15 * 60
API = "https://api.open-meteo.com/v1/forecast"

# Clear-sky noon irradiance on a May day is ~950 W/m²; the array then gives its 720 kW peak.
ARRAY_KW_PER_WM2 = max(c.HOURLY_SOLAR_KW) / 950.0


def reference_temp_c(hour: float) -> float:
    """Typical hot-May temperature the demand profile was built for (29°C at 03:00, 41°C at 15:00)."""
    return 35.0 + 6.0 * math.cos(2 * math.pi * ((hour % 24) - 15) / 24)


def solar_from_ghi(ghi_wm2: float) -> float:
    return max(0.0, ghi_wm2) * ARRAY_KW_PER_WM2


class Weather:
    def __init__(self, fetch: bool = True):
        self._lock = threading.RLock()
        self._times: list[float] = []  # epoch seconds, hourly
        self._temp: list[float] = []
        self._ghi: list[float] = []
        self._cloud: list[float] = []
        self.updated_at: datetime | None = None
        self.error: str | None = None
        self.lat, self.lon, self.name, self.state = LAT, LON, NAME, STATE
        if fetch and os.environ.get("GRIDNOVA_OFFLINE") != "1":
            threading.Thread(target=self._loop, daemon=True).start()

    # ---------- fetching ----------
    def _loop(self):
        while True:
            self.refresh()
            time.sleep(REFRESH_S)

    def set_location(self, name: str, state: str, lat: float, lon: float, fetch: bool = True) -> bool:
        """Moves the campus. Clears the old forecast and fetches the new one straight away."""
        with self._lock:
            self.lat, self.lon, self.name, self.state = lat, lon, name, state
            self._times, self._temp, self._ghi, self._cloud = [], [], [], []
            self.updated_at = None
        return self.refresh() if fetch and os.environ.get("GRIDNOVA_OFFLINE") != "1" else False

    def refresh(self) -> bool:
        with self._lock:
            lat, lon, name = self.lat, self.lon, self.name
        params = {
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,shortwave_radiation,cloud_cover",
            "timezone": "Asia/Kolkata",
            "past_days": 1,
            "forecast_days": 3,
        }
        url = f"{API}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                data = json.load(r)
            with self._lock:
                if (self.lat, self.lon) != (lat, lon):
                    return False  # the campus moved while this was loading
            self.load(data)
            log.info("weather updated from Open-Meteo for %s", name)
            return True
        except Exception as e:  # network, HTTP or parse error: keep the last good data
            with self._lock:
                self.error = f"{type(e).__name__}: {e}"
            log.warning("weather fetch failed (%s); using %s", e, "last data" if self._times else "built-in profile")
            return False

    def load(self, data: dict):
        """Loads an Open-Meteo hourly response."""
        h = data["hourly"]
        times = [datetime.fromisoformat(t).replace(tzinfo=IST).timestamp() for t in h["time"]]
        with self._lock:
            self._times = times
            self._temp = [float(x) if x is not None else math.nan for x in h["temperature_2m"]]
            self._ghi = [float(x) if x is not None else math.nan for x in h["shortwave_radiation"]]
            self._cloud = [float(x) if x is not None else math.nan for x in h["cloud_cover"]]
            self.updated_at = datetime.now(IST)
            self.error = None

    # ---------- reading ----------
    @property
    def live(self) -> bool:
        with self._lock:
            return bool(self._times)

    def _interp(self, series: list[float], ts: float) -> float | None:
        t = self._times
        if not t or ts < t[0] or ts > t[-1]:
            return None
        i = min(int((ts - t[0]) // 3600), len(t) - 2)
        a, b = series[i], series[i + 1]
        if math.isnan(a) or math.isnan(b):
            return None
        frac = (ts - t[i]) / 3600
        return a + (b - a) * frac

    def at(self, when: datetime) -> tuple[float, float, float, bool]:
        """(solar kW, temperature °C, cloud %, from live data?) at a moment."""
        ts = when.timestamp()
        with self._lock:
            ghi = self._interp(self._ghi, ts)
            temp = self._interp(self._temp, ts)
            cloud = self._interp(self._cloud, ts)
        hour = when.astimezone(IST).hour + when.astimezone(IST).minute / 60
        if ghi is None or temp is None:
            return c.clear_sky_solar_kw(hour), reference_temp_c(hour), 0.0, False
        # Open-Meteo GHI is the average over the previous hour; shift half an hour to centre it.
        ghi_c = self._interp(self._ghi, ts + 1800)
        return solar_from_ghi(ghi_c if ghi_c is not None else ghi), temp, cloud or 0.0, True

    def status(self) -> dict:
        with self._lock:
            return {
                "source": "open-meteo" if self._times else "profile",
                "location": self.name,
                "state": self.state,
                "lat": self.lat,
                "lon": self.lon,
                "updatedAt": self.updated_at.isoformat(timespec="seconds") if self.updated_at else None,
                "error": self.error,
            }
