"""Small, explainable gauge-residual learner for future tide-service validation.

NOT wired into the app or PyFES. No observation feed is presently connected.
Training requires verified datum-aligned *real* gauge measurements. The learned
model predicts only meteorological/bias RESIDUAL relative to FES astronomical
tide. It is rejected unless it outperforms a trained constant-bias baseline
on a chronologically unseen validation window. Does not alter astronomy.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from statistics import median


@dataclass(frozen=True)
class GaugeRecord:
    time_utc: datetime
    observed_m: float
    fes_tide_m: float
    pressure_hpa: float
    wind_east_ms: float
    wind_north_ms: float
    datum_aligned: bool
    quality_verified: bool


@dataclass(frozen=True)
class ResidualModel:
    station_id: str
    coefficients: tuple[float, float, float, float]
    trained_through: datetime
    test_mae_model_m: float
    test_mae_bias_m: float
    heldout_count: int
    enabled: bool = True

    def correction(self, pressure_hpa: float, wind_east_ms: float, wind_north_ms: float) -> float:
        x = features(pressure_hpa, wind_east_ms, wind_north_ms)
        return max(-0.75, min(0.75, sum(a*b for a, b in zip(x, self.coefficients))))


class CalibrationRejected(ValueError):
    pass


def features(pressure: float, east: float, north: float) -> tuple[float, float, float, float]:
    if not (850 <= pressure <= 1100 and abs(east) <= 65 and abs(north) <= 65 and
            all(isfinite(x) for x in (pressure, east, north))):
        raise CalibrationRejected("invalid-meteorological-features")
    return (1.0, (1013.25 - pressure)/30.0, east/15.0, north/15.0)


def solve(a: list[list[float]], y: list[float]) -> tuple[float, ...]:
    """Gaussian elimination with pivots for tiny ridge regression (4 weights)."""
    n = len(y)
    m = [a[i][:] + [y[i]] for i in range(n)]
    for col in range(n):
        pivot = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-10:
            raise CalibrationRejected("ill-conditioned-training")
        m[col], m[pivot] = m[pivot], m[col]
        z = m[col][col]
        for j in range(col, n+1):
            m[col][j] /= z
        for row in range(n):
            if row == col:
                continue
            f = m[row][col]
            for j in range(col, n+1):
                m[row][j] -= f*m[col][j]
    return tuple(m[i][n] for i in range(n))


def fit_station(station_id: str, rows: list[GaugeRecord]) -> ResidualModel:
    if not station_id or len(station_id) > 128:
        raise CalibrationRejected("station-required")
    if len(rows) < 720:
        raise CalibrationRejected("insufficient-gauge-history")
    if any(not r.quality_verified or not r.datum_aligned for r in rows):
        raise CalibrationRejected("unverified-quality-or-datum")
    if any(r.time_utc.tzinfo is None or r.time_utc.utcoffset().total_seconds() != 0
           for r in rows):
        raise CalibrationRejected("timestamps-not-UTC")
    if any(rows[i].time_utc <= rows[i-1].time_utc for i in range(1, len(rows))):
        raise CalibrationRejected("unordered-or-duplicate-UTC")
    if (rows[-1].time_utc - rows[0].time_utc).total_seconds() < 30*86400:
        raise CalibrationRejected("history-covers-less-than-30-days")
    for r in rows:
        if not all(isfinite(v) for v in (r.observed_m, r.fes_tide_m)):
            raise CalibrationRejected("invalid-gauge-or-fes-level")
        if abs(r.observed_m-r.fes_tide_m)>5:
            raise CalibrationRejected("unexplained-datum-or-measurement-outlier")
        features(r.pressure_hpa, r.wind_east_ms, r.wind_north_ms)
    split = int(len(rows)*0.75)
    training, holdout = rows[:split], rows[split:]
    if len(holdout)<150:
        raise CalibrationRejected("holdout-too-small")
    x = [features(r.pressure_hpa, r.wind_east_ms, r.wind_north_ms) for r in training]
    target = [r.observed_m-r.fes_tide_m for r in training]
    constant_bias = median(target)
    normal = [[sum(q[i]*q[j] for q in x)+(0.15 if i==j and i>0 else 0.0)
               for j in range(4)] for i in range(4)]
    rhs = [sum(q[i]*b for q,b in zip(x,target)) for i in range(4)]
    weights = solve(normal,rhs)
    truth = [r.observed_m-r.fes_tide_m for r in holdout]
    learned = [max(-0.75,min(0.75,sum(a*b for a,b in zip(
        features(r.pressure_hpa,r.wind_east_ms,r.wind_north_ms),weights))))
        for r in holdout]
    model_mae = sum(abs(a-b) for a,b in zip(truth,learned))/len(truth)
    baseline_mae = sum(abs(a-constant_bias) for a in truth)/len(truth)
    # Meaningful absolute AND relative improvement on unseen future data;
    # otherwise leave the source tide unmodified.
    if not (model_mae + 0.015 < baseline_mae and model_mae <= baseline_mae*0.9):
        raise CalibrationRejected("no-heldout-improvement-over-bias")
    return ResidualModel(
        station_id=station_id, coefficients=weights,
        trained_through=training[-1].time_utc,
        test_mae_model_m=model_mae, test_mae_bias_m=baseline_mae,
        heldout_count=len(holdout),
    )
