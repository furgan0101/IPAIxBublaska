"""PEGELONLINE connector - German waterway gauges (WSV / GDWS).

PEGELONLINE is the free, keyless open-data service of the Wasserstrassen- und
Schifffahrtsverwaltung des Bundes (WSV). The REST v2 stations endpoint returns
every federal gauge with latitude, longitude, longname and a water-level
timeseries. Each current measurement carries "stateMnwMhw" (the station's own
classification against its characteristic mean low / mean HIGH water values,
MNW / MHW) and "stateNswHsw" (against the low / HIGH navigable marks, NSW / HSW).

A flood candidate is a gauge whose current water level is HIGH relative to that
station's own characteristic high-water reference, i.e. stateMnwMhw == "high"
(above mean high water) or stateNswHsw in {high, veryhigh, extreme} (at or above
the high navigable / flood marks). This uses the station-specific reference the
API exposes, so it adapts per gauge instead of a single global threshold. We do
NOT pull "characteristicValues" (not returned by default); the per-measurement
state flags are the documented, authoritative equivalent and keep one fetch
light. Coordinates come straight from the station, so no geocoding is needed.

Endpoint (keyless, public):
  https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json
    ?includeTimeseries=true&includeCurrentMeasurement=true
"""
from __future__ import annotations

from typing import Any

import httpx

from ingestion.base import FetchedItem, get_json, parse_utc
from ingestion.config import IngestionSettings

#: Base REST v2 stations endpoint (keyless).
_STATIONS_URL: str = (
    "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json"
)

#: Water-level timeseries identifier ("Wasserstand", reported in cm).
_WATER_LEVEL_KEY: str = "W"

#: stateMnwMhw values that mean "above mean HIGH water" (MHW).
_HIGH_MNW_STATES: frozenset[str] = frozenset({"high"})

#: stateNswHsw values that mean "at/above the HIGH navigable / flood marks".
_HIGH_HSW_STATES: frozenset[str] = frozenset({"high", "veryhigh", "extreme"})

#: Safety cap so a single poll stays light even if the feed grows.
_MAX_STATIONS: int = 6000


class PegelonlineConnector:
    name: str = "pegelonline"

    def __init__(self, settings: IngestionSettings) -> None:
        self._max_stations: int = _MAX_STATIONS

    async def fetch(self, client: httpx.AsyncClient) -> list[FetchedItem]:
        params: dict[str, Any] = {
            "includeTimeseries": "true",
            "includeCurrentMeasurement": "true",
        }
        try:
            payload = await get_json(client, _STATIONS_URL, params=params)
        except Exception:
            # Never raise out of fetch: a transport / decode error yields nothing.
            return []

        if not isinstance(payload, list):
            return []

        items: list[FetchedItem] = []
        for station in payload[: self._max_stations]:
            if not isinstance(station, dict):
                continue
            item = self._to_item(station)
            if item is not None:
                items.append(item)
        return items

    def _to_item(self, station: dict[str, Any]) -> FetchedItem | None:
        lat = station.get("latitude")
        lon = station.get("longitude")
        # bool is a subclass of int; reject it so a JSON `true` can't become 1.0.
        if isinstance(lat, bool) or isinstance(lon, bool):
            return None
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            return None  # every item must carry coords; skip if absent

        series = station.get("timeseries")
        if not isinstance(series, list):
            return None

        water: dict[str, Any] | None = None
        for entry in series:
            if (
                isinstance(entry, dict)
                and str(entry.get("shortname") or "").upper() == _WATER_LEVEL_KEY
            ):
                water = entry
                break
        if water is None:
            return None

        measurement = water.get("currentMeasurement")
        if not isinstance(measurement, dict):
            return None

        state_mnw = str(measurement.get("stateMnwMhw") or "").strip().lower()
        state_hsw = str(measurement.get("stateNswHsw") or "").strip().lower()
        is_high = state_mnw in _HIGH_MNW_STATES or state_hsw in _HIGH_HSW_STATES
        if not is_high:
            return None  # only HIGH gauges are flood candidates

        timestamp_raw = measurement.get("timestamp")
        if not timestamp_raw:
            return None
        try:
            timestamp = parse_utc(str(timestamp_raw))
        except (ValueError, TypeError):
            return None

        uuid = station.get("uuid")
        number = station.get("number")
        station_id = str(uuid or number or "").strip()
        if not station_id:
            return None

        longname = str(
            station.get("longname") or station.get("shortname") or ""
        ).strip()
        place = longname or station_id

        water_body = ""
        water_meta = station.get("water")
        if isinstance(water_meta, dict):
            water_body = str(
                water_meta.get("longname") or water_meta.get("shortname") or ""
            ).strip()

        value = measurement.get("value")
        unit = str(water.get("unit") or "cm").strip() or "cm"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            level_text = f"current level {float(value):.0f} {unit}"
        else:
            level_text = "current level unavailable"

        if state_hsw in _HIGH_HSW_STATES:
            mark_text = "at or above the high navigable / flood mark (HSW)"
        else:
            mark_text = "above the mean high water mark (MHW)"

        on_water = f" on the {water_body}" if water_body else ""
        text = (
            f"High water at gauge {place}{on_water}: {level_text}, "
            f"{mark_text}. Source: PEGELONLINE (WSV)."
        )

        if number:
            url = (
                "https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr="
                + str(number)
            )
        else:
            url = "https://www.pegelonline.wsv.de/"

        return FetchedItem(
            source="pegelonline",
            source_id=f"pegelonline:{station_id}",
            author="WSV PEGELONLINE",
            text=text[:600],
            timestamp=timestamp,
            url=url,
            lat=float(lat),
            lon=float(lon),
            event_type="flood",
            place_hint=place or None,
        )
