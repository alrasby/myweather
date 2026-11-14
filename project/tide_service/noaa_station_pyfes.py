"""PyFES astronomical tides from published NOAA CO-OPS *station* harmonics.

Available without a FES2022b atlas, but ONLY for the exact NOAA tidal
station with supported, verified Greenwich harmonic constituents. It is not
FES2022b, does not cover an arbitrary nearby coast and is not a forecast of
storm surge or chart-datum water level. No app integration by default.

The metadata endpoint is fixed to NOAA HTTPS; clients never supply URLs.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .fes2022_predict import TideUnavailable, extrema, utc_time, validate_position, STEP_MINUTES

NOAA_API = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/"
STATION_ID = re.compile(r"^[0-9]{7}$")
WAVE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,7}$")
MAX_JSON_BYTES = 300_000


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _noaa_json(path: str, opener=None) -> dict:
    # Only a validated numeric station ID may form this server-side URL.
    opener = opener or build_opener(_NoRedirect)
    req = Request(NOAA_API + path, headers={"Accept": "application/json",
                                           "User-Agent": "MyWeatherPro-TideQA/1.0"})
    try:
        with opener.open(req, timeout=8) as response:
            body = response.read(MAX_JSON_BYTES + 1)
            if len(body) > MAX_JSON_BYTES:
                raise TideUnavailable("noaa-response-too-large")
            value = json.loads(body.decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError, UnicodeError) as exc:
        raise TideUnavailable("noaa-source-unavailable") from exc
    if not isinstance(value, dict):
        raise TideUnavailable("noaa-invalid-json")
    return value


def load_noaa_station(station_id: str, opener=None) -> tuple[dict, dict]:
    if not isinstance(station_id, str) or not STATION_ID.fullmatch(station_id):
        raise TideUnavailable("invalid-noaa-tide-station-id")
    response = _noaa_json(station_id + ".json", opener)
    # NOAA returns {"count":1,"stations":[...]} rather than the station
    # object as the top-level JSON. Refuse ambiguous or empty collections.
    records = response.get("stations")
    if not isinstance(records, list) or len(records) != 1 or not isinstance(records[0], dict):
        raise TideUnavailable("noaa-station-metadata-unavailable")
    station = records[0]
    if str(station.get("id")) != station_id or station.get("tidal") is not True:
        raise TideUnavailable("noaa-station-not-tidal-or-mismatch")
    harmonic = _noaa_json(station_id + "/harcon.json?units=metric", opener)
    return station, harmonic


def parse_station_harmonics(station: dict, harmonic: dict,
                            station_id: str) -> tuple[float, float, dict[str, tuple[float, float]]]:
    if not isinstance(station, dict) or str(station.get("id")) != station_id or \
       station.get("tidal") is not True:
        raise TideUnavailable("noaa-station-unverified")
    try:
        lat, lon = float(station["lat"]), float(station["lng"])
    except (ValueError, TypeError, KeyError) as exc:
        raise TideUnavailable("noaa-station-coordinates-invalid") from exc
    validate_position(lat, lon, 12)
    if not isinstance(harmonic, dict) or str(harmonic.get("units", "")).lower() not in \
            {"meters", "meter", "metric"}:
        raise TideUnavailable("noaa-harmonics-require-metric-units")
    entries = harmonic.get("HarmonicConstituents")
    if not isinstance(entries, list) or not 8 <= len(entries) <= 100:
        raise TideUnavailable("noaa-harmonics-incomplete")
    output: dict[str, tuple[float, float]] = {}
    for row in entries:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str):
            raise TideUnavailable("noaa-harmonic-invalid")
        name = row["name"]
        if not WAVE_NAME.fullmatch(name) or name in output:
            raise TideUnavailable("noaa-harmonic-name-or-duplicate")
        try:
            amplitude_m = float(row["amplitude"])
            phase = float(row["phase_GMT"])
        except (ValueError, TypeError, KeyError) as exc:
            raise TideUnavailable("noaa-harmonic-invalid") from exc
        if (not math.isfinite(amplitude_m) or not 0 <= amplitude_m <= 30 or
            not math.isfinite(phase) or not 0 <= phase <= 360):
            raise TideUnavailable("noaa-harmonic-out-of-range")
        # NOAA metadata in metres, PyFES Darwin predictor in centimetres.
        output[name] = (amplitude_m * 100, phase)
    if not {"M2", "S2", "K1", "O1"}.issubset(output):
        raise TideUnavailable("noaa-major-harmonics-missing")
    return lat, lon, output


def predict_noaa_station(station_id: str, station: dict, harmonic: dict,
                         start: datetime, hours: int,
                         evaluator=None) -> dict:
    """Station-only forecast. evaluator injected for deterministic offline tests."""
    if not STATION_ID.fullmatch(station_id):
        raise TideUnavailable("invalid-noaa-tide-station-id")
    lat, lon, harmonics = parse_station_harmonics(station, harmonic, station_id)
    validate_position(lat, lon, hours)
    if start.tzinfo is None or start.utcoffset() != timedelta(0) or \
            start.second or start.microsecond or start.minute % STEP_MINUTES:
        raise TideUnavailable("invalid-utc-start")
    count = hours * 60 // STEP_MINUTES + 1
    times = [start + timedelta(minutes=i * STEP_MINUTES) for i in range(count)]
    if evaluator is None:
        try:
            import numpy as np
            import pyfes
        except ImportError as exc:
            raise TideUnavailable("official-pyfes-not-installed") from exc
        dates = np.array([np.datetime64(t.replace(tzinfo=None), "s") for t in times])
        try:
            short, long_period = pyfes.evaluate_tide_from_constituents(
                harmonics, dates, latitude=lat, settings=pyfes.FESSettings())
        except Exception as exc:
            raise TideUnavailable("noaa-harmonics-pyfes-incompatible") from exc
    else:
        short, long_period = evaluator(harmonics, times, lat)
    if len(short) != count or len(long_period) != count:
        raise TideUnavailable("noaa-incomplete-prediction")
    samples = []
    for t, s, lp in zip(times, short, long_period):
        if not all(math.isfinite(float(x)) for x in (s, lp)):
            raise TideUnavailable("noaa-nonfinite-prediction")
        level_m = (float(s) + float(lp)) / 100.0
        if abs(level_m) > 30:
            raise TideUnavailable("noaa-implausible-level")
        samples.append({"time": t.isoformat().replace("+00:00", "Z"),
                        "level_m": round(level_m, 4)})
    return {
        "source": "NOAA_COOPS_STATION_HARMONICS",
        "method": "PyFES Darwin station harmonic prediction",
        "station_id": station_id,
        "station_name": str(station.get("name", ""))[:120],
        "latitude": lat, "longitude": lon,
        "datum": "station_harmonic_zero_not_chart_datum",
        "height_unit": "m", "step_minutes": STEP_MINUTES,
        "status": "station_only_unvalidated_for_navigation",
        "start": samples[0]["time"], "end": samples[-1]["time"],
        "samples": samples, "extrema": extrema(samples),
        "not_for_navigation": True,
    }


def main() -> int:
    import argparse
    p = argparse.ArgumentParser(description="Station-only NOAA harmonic PyFES pilot")
    p.add_argument("--station", required=True)
    p.add_argument("--start", required=True, help="UTC 5-minute boundary")
    p.add_argument("--hours", type=int, default=24)
    a = p.parse_args()
    try:
        start = utc_time(a.start)
        validate_position(0, 0, a.hours)
        station, harmonic = load_noaa_station(a.station)
        result = predict_noaa_station(a.station, station, harmonic, start, a.hours)
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
        return 0
    except TideUnavailable as exc:
        print(json.dumps({"status": "unavailable", "reason": str(exc), "samples": []}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
