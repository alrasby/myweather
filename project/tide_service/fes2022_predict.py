"""Scientific FES2022b astronomical tide forecasting adapter (isolated pilot).

Official PyFES predicts from FES2022b harmonic constituents and astronomical
arguments; the atlas is NOT included here. No synthetic tides are used in
production and no output is published without a real configured atlas.

Output is an *astronomical tide relative to atlas MSL*, not total water level
and not local harbour chart datum. Gauge-based calibration is separate.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable

STEP_MINUTES = 5
MAX_HOURS = 168
UTC = timezone.utc


class TideUnavailable(ValueError):
    """No defensible prediction can be made from the actual configured model."""


def utc_time(value: str) -> datetime:
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError) as exc:
        raise TideUnavailable("invalid-utc-start") from exc
    if t.tzinfo is None or t.utcoffset() != timedelta(0):
        raise TideUnavailable("start-must-be-utc")
    if t.second or t.microsecond or t.minute % STEP_MINUTES:
        raise TideUnavailable("start-not-on-five-minute-boundary")
    return t


def validate_position(lat: float, lon: float, hours: int) -> None:
    if not (math.isfinite(lat) and -90 <= lat <= 90 and
            math.isfinite(lon) and -180 <= lon <= 180):
        raise TideUnavailable("invalid-coordinates")
    if isinstance(hours, bool) or not isinstance(hours, int) or not 12 <= hours <= MAX_HOURS:
        raise TideUnavailable("invalid-forecast-horizon")


def extrema(samples: list[dict]) -> list[dict]:
    """Only find reversals already present in true 5-minute model predictions.

    These are grid-resolution estimates; no fitted sine curve or fabricated
    extrapolation, and no event is reported outside the sampled interval.
    """
    events: list[dict] = []
    for i in range(1, len(samples) - 1):
        left = samples[i - 1]["level_m"]
        mid = samples[i]["level_m"]
        right = samples[i + 1]["level_m"]
        kind = ("high" if left < mid and mid >= right else
                "low" if left > mid and mid <= right else None)
        if kind is not None:
            events.append({
                "kind": kind, "time": samples[i]["time"],
                "level_m": mid, "time_resolution_minutes": STEP_MINUTES
            })
    return events


def predict(
    lat: float, lon: float, start: datetime, hours: int,
    evaluate: Callable[[list[datetime], float, float], Iterable[tuple[float, float, int]]],
) -> dict:
    """Deterministic model adapter. Evaluate MUST be backed by real PyFES data.

    The injectable evaluator exists solely for offline contract tests; the
    production entrypoint always instantiates an atlas-backed evaluator.
    """
    validate_position(lat, lon, hours)
    if start.tzinfo is None or start.utcoffset() != timedelta(0):
        raise TideUnavailable("start-must-be-utc")
    if start.second or start.microsecond or start.minute % STEP_MINUTES:
        raise TideUnavailable("start-not-on-five-minute-boundary")
    count = hours * 60 // STEP_MINUTES + 1
    times = [start + timedelta(minutes=i * STEP_MINUTES) for i in range(count)]
    series = list(evaluate(times, lat, lon))
    if len(series) != count:
        raise TideUnavailable("incomplete-atlas-forecast")
    points: list[dict] = []
    positive_flags: list[int] = []
    for t, item in zip(times, series):
        if len(item) != 3:
            raise TideUnavailable("invalid-model-result")
        short_cm, long_cm, quality_flag = item
        if not all(isinstance(v, (float, int)) and math.isfinite(v) for v in (short_cm, long_cm, quality_flag)):
            raise TideUnavailable("nonfinite-model-value")
        # PyFES 0 = undefined; <0 = spatial EXTRAPOLATION.
        # For high-integrity forecasts, do not silently promote extrapolations.
        if int(quality_flag) != quality_flag or quality_flag <= 0:
            raise TideUnavailable("undefined-or-extrapolated-atlas-cell")
        level_m = (short_cm + long_cm) / 100.0  # FES heights are centimetres
        if abs(level_m) > 30:
            raise TideUnavailable("implausible-model-elevation")
        positive_flags.append(int(quality_flag))
        points.append({"time": t.isoformat().replace("+00:00", "Z"),
                       "level_m": round(level_m, 4)})
    return {
        "source": "FES2022b",
        "method": "PyFES astronomical harmonic prediction",
        "datum": "atlas_mean_sea_level",
        "height_unit": "m",
        "status": "physical_model_unvalidated_at_local_gauge",
        "interpolation_points_min": min(positive_flags),
        "start": times[0].isoformat().replace("+00:00", "Z"),
        "end": times[-1].isoformat().replace("+00:00", "Z"),
        "step_minutes": STEP_MINUTES,
        "latitude": lat, "longitude": lon,
        "samples": points,
        "extrema": extrema(points),
        "not_for_navigation": True,
    }


class PyFESAtlas:
    """Fail-closed production adapter. Never downloads or guesses model data."""

    def __init__(self, config_path: str):
        if not config_path or not Path(config_path).is_file():
            raise TideUnavailable("fes2022-atlas-config-required")
        try:
            import numpy as np
            import pyfes
        except ImportError as exc:
            raise TideUnavailable("pyfes-not-installed") from exc
        self.np = np
        self.pyfes = pyfes
        try:
            self.config = pyfes.config.load(config_path)
            self.model = self.config.models["tide"]
        except Exception as exc:
            raise TideUnavailable("invalid-or-incomplete-fes-atlas") from exc

    def __call__(self, times: list[datetime], lat: float, lon: float):
        np, pyfes = self.np, self.pyfes
        dates = np.array([np.datetime64(t.replace(tzinfo=None), "s") for t in times])
        lats = np.full(len(times), lat, dtype=np.float64)
        lons = np.full(len(times), lon, dtype=np.float64)
        tide, long_period, flags = pyfes.evaluate_tide(
            self.model, dates, lons, lats, settings=self.config.settings
        )
        return zip(tide.tolist(), long_period.tolist(), flags.tolist())


def main() -> int:
    ap = argparse.ArgumentParser(description="Real FES2022b ocean tide predictor")
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--hours", type=int, default=48)
    ap.add_argument("--start", required=True, help="UTC ISO timestamp on 5-min boundary")
    ap.add_argument("--config", default=os.environ.get("FES2022_CONFIG", ""))
    opts = ap.parse_args()
    try:
        start = utc_time(opts.start)
        validate_position(opts.lat, opts.lon, opts.hours)
        result = predict(opts.lat, opts.lon, start, opts.hours, PyFESAtlas(opts.config))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 0
    except TideUnavailable as exc:
        print(json.dumps({"status": "unavailable", "reason": str(exc), "samples": []}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
