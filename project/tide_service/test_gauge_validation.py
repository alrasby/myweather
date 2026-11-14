"""Generated offline fixtures test only code paths, not real tide skill."""
import math
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from tide_service.gauge_residual import GaugeRecord, CalibrationRejected
from tide_service.gauge_validation import (
    GaugeAudit, evaluate_station, event_timing_mae_minutes,
)

START=datetime(2026,8,1,tzinfo=timezone.utc)
AUDIT=GaugeAudit(
    station_id="test-gauge-not-real",
    provider="synthetic-test-only",
    datum_document="synthetic-reference-alignment-fixture",
    conversion_evidence="synthetic-zero-datum-offset",
    verification_reviewer="unit-test-only",
)


def records(days=35, pressure_effect=True):
    rows=[]
    for i in range(days*24):
        t=START+timedelta(hours=i)
        astro=0.85*math.cos(i*math.pi/6)
        pressure=1013.25+13*math.sin(i/37)
        east=7*math.sin(i/11)
        north=6*math.cos(i/17)
        residual=0.16
        if pressure_effect:
            residual += (1013.25-pressure)/30*0.12+east/15*0.14-north/15*0.1
        rows.append(GaugeRecord(
            t, astro+residual+0.002*math.cos(i/5),astro,
            pressure,east,north,True,True,
            t-timedelta(hours=6),"offline-synthetic-forecast-test"))
    return rows


class GaugeValidationContract(unittest.TestCase):
    def test_metrics_timing_provenance_and_candidate_model(self):
        result=evaluate_station(AUDIT,records())
        self.assertEqual(result["source"],"verified_real_tide_gauge_required")
        self.assertEqual(result["method"],"chronological_75_25_station_holdout")
        self.assertEqual(result["datum"],"FES_atlas_MSL")
        self.assertGreater(result["heldout_rows"],150)
        self.assertAlmostEqual(result["sample_spacing_minutes"],60)
        self.assertGreater(result["fes_raw"]["mae_m"],result["bias_only"]["mae_m"])
        self.assertFalse(result["navigation_validated"])
        self.assertGreater(result["high_low_event"]["matched_events"],4)
        self.assertLessEqual(result["high_low_event"]["mae_minutes"],60)
        self.assertTrue(result["ml_residual"]["eligible"])

    def test_ai_must_stay_off_when_station_bias_is_good_enough(self):
        result=evaluate_station(AUDIT,records(pressure_effect=False))
        self.assertFalse(result["ml_residual"]["eligible"])
        self.assertLess(result["bias_only"]["mae_m"],result["fes_raw"]["mae_m"])

    def test_reject_missing_evidence_and_bad_station_datum(self):
        rows=records()
        with self.assertRaisesRegex(CalibrationRejected,"provenance"):
            evaluate_station(replace(AUDIT,conversion_evidence=""),rows)
        with self.assertRaisesRegex(CalibrationRejected,"datum"):
            evaluate_station(AUDIT,[replace(rows[0],datum_aligned=False)]+rows[1:])
        with self.assertRaisesRegex(CalibrationRejected,"quality"):
            evaluate_station(AUDIT,[replace(rows[0],quality_verified=False)]+rows[1:])

    def test_reject_too_little_history_and_gauge_gaps(self):
        with self.assertRaisesRegex(CalibrationRejected,"insufficient"):
            evaluate_station(AUDIT,records(20))
        rows=records()
        rows[12]=replace(rows[12],time_utc=rows[11].time_utc)
        with self.assertRaisesRegex(CalibrationRejected,"duplicate"):
            evaluate_station(AUDIT,rows)
        rows=records()
        for n in range(100,180):
            rows[n]=replace(rows[n],time_utc=rows[n].time_utc+timedelta(days=40))
        with self.assertRaisesRegex(CalibrationRejected,"unordered"):
            evaluate_station(AUDIT,rows)
        rows=records()
        rows[0]=replace(rows[0],observed_m=float("nan"))
        with self.assertRaisesRegex(CalibrationRejected,"nonfinite"):
            evaluate_station(AUDIT,rows)

    def test_do_not_report_event_accuracy_with_unmatched_or_monotonic_series(self):
        rows=records()
        # A completely flat model is not a valid high-low event predictor.
        flat=[replace(r,fes_tide_m=0.0) for r in rows]
        score,n=event_timing_mae_minutes(flat)
        self.assertIsNone(score)
        self.assertEqual(n,0)


if __name__=="__main__":
    unittest.main()
