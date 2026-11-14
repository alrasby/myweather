"""Strict tide-gauge verification: physically meaningful holdout skill.

This module cannot certify a model by itself. It operates on genuine
UTC-aligned observations verified by the operator against an independently
audited station datum. No gauge observations are bundled or fabricated.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import timedelta
from math import isfinite, sqrt
from statistics import median

from .gauge_residual import GaugeRecord, CalibrationRejected, fit_station

MIN_ROWS = 720
MIN_HOLDOUT = 150
MIN_HISTORY_DAYS = 30


@dataclass(frozen=True)
class GaugeAudit:
    station_id: str
    provider: str
    datum_document: str
    conversion_evidence: str
    verification_reviewer: str
    time_reference: str = "UTC"
    vertical_datum: str = "FES_atlas_MSL_converted_from_gauge_datum"

    def check(self) -> None:
        if (not all(isinstance(s, str) and len(s.strip()) >= 3 for s in
                    (self.station_id, self.provider, self.datum_document,
                     self.conversion_evidence, self.verification_reviewer)) or
            self.time_reference != "UTC" or
            self.vertical_datum != "FES_atlas_MSL_converted_from_gauge_datum"):
            raise CalibrationRejected("station-provenance-or-datum-unverified")


def mae(errors: list[float]) -> float:
    return sum(abs(e) for e in errors)/len(errors)


def rmse(errors: list[float]) -> float:
    return sqrt(sum(e*e for e in errors)/len(errors))


def quantile_abs(errors: list[float], q: float) -> float:
    ordered = sorted(map(abs, errors))
    return ordered[min(len(ordered)-1, max(0, int(q*(len(ordered)-1))))]


def _events(rows: list[GaugeRecord], observed: bool) -> list[tuple[str, int]]:
    """Conservative event timing, same 3-point smoothing for model and gauge.

    Hourly data only resolves extrema to roughly 1h, not an exact prediction.
    Require that the candidate is separated by 3h from the last same-type
    event; do not infer or extrapolate outside the observations.
    """
    vals = [r.observed_m if observed else r.fes_tide_m for r in rows]
    if len(vals) < 6:
        return []
    smooth = [(vals[i-1]+vals[i]+vals[i+1])/3 for i in range(1,len(vals)-1)]
    events: list[tuple[str,int]] = []
    for i in range(1,len(smooth)-1):
        left,mid,right = smooth[i-1:i+2]
        kind = "high" if left < mid > right else "low" if left > mid < right else None
        if not kind:
            continue
        ix = i+1  # centred window lost the first original sample
        if events and events[-1][0] == kind:
            continue  # a noisy extra peak must not become a valid tide
        if events and (rows[ix].time_utc-rows[events[-1][1]].time_utc).total_seconds() < 3*3600:
            continue
        events.append((kind,ix))
    return events


def event_timing_mae_minutes(rows: list[GaugeRecord]) -> tuple[float | None,int]:
    model = _events(rows,False)
    observed = _events(rows,True)
    matched: list[float] = []
    used: set[int] = set()
    for kind, i in model:
        candidates = [
            (abs((rows[i].time_utc-rows[j].time_utc).total_seconds())/60,j)
            for k,j in observed if k == kind and j not in used
        ]
        if not candidates:
            continue
        dist,j = min(candidates)
        if dist <= 180:
            used.add(j)
            matched.append(dist)
    return (sum(matched)/len(matched),len(matched)) if matched else (None,0)


def evaluate_station(audit: GaugeAudit, rows: list[GaugeRecord]) -> dict:
    audit.check()
    if len(rows) < MIN_ROWS:
        raise CalibrationRejected("insufficient-verified-observations")
    if any(not r.quality_verified or not r.datum_aligned for r in rows):
        raise CalibrationRejected("invalid-gauge-quality-or-datum")
    if any(r.time_utc.tzinfo is None or r.time_utc.utcoffset() != timedelta(0)
           for r in rows):
        raise CalibrationRejected("non-utc-gauge-time")
    if any(not all(isfinite(v) for v in (r.observed_m,r.fes_tide_m))
           for r in rows):
        raise CalibrationRejected("nonfinite-gauge-observation")
    intervals = [(rows[i].time_utc-rows[i-1].time_utc).total_seconds()/60
                 for i in range(1,len(rows))]
    if any(dt <= 0 for dt in intervals):
        raise CalibrationRejected("unordered-or-duplicate-gauge-time")
    spacing = median(intervals)
    if not (5 <= spacing <= 60):
        raise CalibrationRejected("unsupported-gauge-sample-spacing")
    if sum(dt > spacing*1.5 for dt in intervals) > len(intervals)*0.03:
        raise CalibrationRejected("excessive-gauge-data-gaps")
    if (rows[-1].time_utc-rows[0].time_utc).total_seconds() < MIN_HISTORY_DAYS*86400:
        raise CalibrationRejected("gauge-history-too-short")
    split = int(len(rows)*0.75)
    training, held = rows[:split],rows[split:]
    if len(held) < MIN_HOLDOUT:
        raise CalibrationRejected("gauge-holdout-too-short")
    bias = median([r.observed_m-r.fes_tide_m for r in training])
    raw_errors = [r.observed_m-r.fes_tide_m for r in held]
    bias_errors = [err-bias for err in raw_errors]
    highlow_mae,matched = event_timing_mae_minutes(held)
    # A candidate learner must independently beat the bias-only baseline
    # on this exact time-held-out segment before it can even be considered.
    ml: dict = {"eligible":False,"reason":"no-heldout-improvement-or-no-gauge-model"}
    try:
        model=fit_station(audit.station_id,rows)
        residual_errors = [
            r.observed_m-r.fes_tide_m-
            model.correction(r.pressure_hpa,r.wind_east_ms,r.wind_north_ms)
            for r in held
        ]
        if mae(residual_errors) + 0.015 < mae(bias_errors) and \
           mae(residual_errors) <= mae(bias_errors)*0.90:
            ml={"eligible":True,
                "heldout_mae_m":round(mae(residual_errors),4),
                "heldout_rmse_m":round(rmse(residual_errors),4),
                "weights":list(model.coefficients),
                "training_end":model.trained_through.isoformat()}
    except CalibrationRejected:
        pass
    return {
        "audit":asdict(audit),
        "method":"chronological_75_25_station_holdout",
        "source":"verified_real_tide_gauge_required",
        "datum":"FES_atlas_MSL",
        "sample_spacing_minutes":spacing,
        "training_rows":len(training),
        "heldout_rows":len(held),
        "holdout_start_utc":held[0].time_utc.isoformat(),
        "fes_raw":{"mae_m":round(mae(raw_errors),4),
                   "rmse_m":round(rmse(raw_errors),4),
                   "p95_abs_m":round(quantile_abs(raw_errors,.95),4)},
        "bias_only":{"trained_station_offset_m":round(bias,4),
                     "mae_m":round(mae(bias_errors),4),
                     "rmse_m":round(rmse(bias_errors),4)},
        "high_low_event":{"mae_minutes":round(highlow_mae,2) if highlow_mae is not None else None,
                          "matched_events":matched,
                          "time_resolution_minutes":spacing},
        "ml_residual":ml,
        "navigation_validated":False,
    }
