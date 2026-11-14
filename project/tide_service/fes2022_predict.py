"""Scientific FES2022b astronomical tide forecasting adapter (isolated pilot).

Official PyFES predicts from FES2022b harmonic constituents and astronomical
arguments; the atlas is NOT included here. No synthetic tides are used in
production and no output is published without a real configured atlas.

Output is an *astronomical tide relative to atlas MSL*, not total water level
and not local harbour chart datum. Gauge-based calibration is separate.
"""
from __future__ import annotations

import argparse
import hashlib
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



def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024*1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_official_atlas_manifest(config_path: str, manifest_path: str) -> None:
    """Require operator-audited full FES2022b atlas provenance before serving.

    The manifest is an operator attestation tied to actual SHA-256 model files,
    not an automatically issued certification from CNES. Without original
    AVISO data, this is intentionally impossible to satisfy in normal CI.
    """
    if not manifest_path or not Path(manifest_path).is_file():
        raise TideUnavailable("fes2022-provenance-manifest-required")
    try:
        meta = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TideUnavailable("fes2022-provenance-manifest-invalid") from exc
    if (not isinstance(meta, dict) or meta.get("edition") != "FES2022b" or
        meta.get("producer") != "CNES/LEGOS/Noveltis/CLS" or
        meta.get("quantity") != "ocean_tide_height" or
        meta.get("units") != "cm" or meta.get("datum") != "atlas_msl"):
        raise TideUnavailable("fes2022-atlas-edition-or-units-unverified")
    config_sha = meta.get("config_sha256")
    if not isinstance(config_sha, str) or _sha256(Path(config_path)) != config_sha:
        raise TideUnavailable("fes2022-config-hash-mismatch")
    files = meta.get("files")
    format_name = meta.get("format")
    count_ok = ((format_name == "cartesian-34" and isinstance(files, list) and len(files)==34) or
                (format_name == "native-34" and isinstance(files, list) and len(files)==1))
    if not count_ok:
        raise TideUnavailable("fes2022-constituent-atlas-incomplete")
    total = 0
    seen: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            raise TideUnavailable("fes2022-provenance-file-invalid")
        filename, expected = item.get("path"), item.get("sha256")
        if (not isinstance(filename, str) or not isinstance(expected, str) or
            len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected)):
            raise TideUnavailable("fes2022-provenance-file-invalid")
        real = Path(filename).resolve()
        if not real.is_file() or str(real) in seen:
            raise TideUnavailable("fes2022-atlas-file-missing-or-duplicate")
        seen.add(str(real))
        total += real.stat().st_size
        if _sha256(real) != expected:
            raise TideUnavailable("fes2022-atlas-file-hash-mismatch")
    # Reject tiny low-resolution PyFES demo grids masquerading as FES2022b.
    if total < 500_000_000:
        raise TideUnavailable("fes2022-atlas-too-small-to-be-full-edition")



def regional_bounds(text: str) -> tuple[float, float, float, float] | None:
    """Optional PyFES regional sub-grid for memory-bounded operator shards.

    Bounds are west,south,east,north. A global service should deploy separate
    audited shards or provision enough RAM; never pretend a sub-grid is world
    coverage. Dateline-crossing regions require two explicit shards.
    """
    if not text:
        return None
    try:
        items = tuple(float(x.strip()) for x in text.split(","))
    except ValueError as exc:
        raise TideUnavailable("invalid-fes-region-bbox") from exc
    if (len(items) != 4 or not all(math.isfinite(v) for v in items) or
        not -180 <= items[0] < items[2] <= 180 or
        not -90 <= items[1] < items[3] <= 90 or
        items[2] - items[0] < 0.1 or items[3] - items[1] < 0.1):
        raise TideUnavailable("invalid-fes-region-bbox")
    return items

class PyFESAtlas:
    """Fail-closed production adapter. Never downloads or guesses model data."""

    def __init__(self, config_path: str, manifest_path: str = "",
                 bbox: tuple[float, float, float, float] | None = None):
        if not config_path or not Path(config_path).is_file():
            raise TideUnavailable("fes2022-atlas-config-required")
        verify_official_atlas_manifest(config_path, manifest_path)
        try:
            import numpy as np
            import pyfes
        except ImportError as exc:
            raise TideUnavailable("pyfes-not-installed") from exc
        self.np = np
        self.pyfes = pyfes
        self.bbox = bbox
        try:
            self.config = (pyfes.config.load(config_path, bbox=bbox) if bbox
                           else pyfes.config.load(config_path))
            self.model = self.config.models["tide"]
        except Exception as exc:
            raise TideUnavailable("invalid-or-incomplete-fes-atlas") from exc

    def __call__(self, times: list[datetime], lat: float, lon: float):
        if self.bbox:
            west, south, east, north = self.bbox
            if not west <= lon <= east or not south <= lat <= north:
                raise TideUnavailable("outside-provisioned-atlas-region")
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
    ap.add_argument("--manifest", default=os.environ.get("FES2022_MANIFEST", ""))
    opts = ap.parse_args()
    try:
        start = utc_time(opts.start)
        validate_position(opts.lat, opts.lon, opts.hours)
        result = predict(opts.lat, opts.lon, start, opts.hours, PyFESAtlas(opts.config, opts.manifest))
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
        return 0
    except TideUnavailable as exc:
        print(json.dumps({"status": "unavailable", "reason": str(exc), "samples": []}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
