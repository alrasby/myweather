"""Synthetic offline training fixtures. NEVER ship them as gauge observations."""
import math
import unittest
from datetime import datetime, timedelta, timezone

from tide_service.gauge_residual import (
    CalibrationRejected, GaugeRecord, fit_station,
)

START = datetime(2026, 8, 1, tzinfo=timezone.utc)


def history(days=33, with_real_relation=True):
    rows = []
    for i in range(days*24):
        t = START+timedelta(hours=i)
        p = 1013.25+20*math.sin(i/20)
        u = 6*math.sin(i/13)
        v = 5*math.cos(i/17)
        astro = 0.5*math.sin(i*math.pi/6)
        true_residual = (0.08+(1013.25-p)/30*0.16+u/15*0.11-v/15*0.12
                         if with_real_relation else 0.08)
        observed = astro+true_residual+0.004*math.sin(i/3)
        rows.append(GaugeRecord(t,observed,astro,p,u,v,True,True,
                                t-timedelta(hours=6),"offline-synthetic-forecast-test"))
    return rows


class GaugeMLSafety(unittest.TestCase):
    def test_only_observation_grounded_holdout_improvement_activates(self):
        model = fit_station("muscat-gauge-verified",history())
        self.assertGreaterEqual(model.heldout_count,150)
        self.assertTrue(model.enabled)
        self.assertLess(model.test_mae_model_m,model.test_mae_bias_m*0.9)
        self.assertLessEqual(abs(model.correction(990,20,5)),0.75)
        self.assertEqual(model.station_id,"muscat-gauge-verified")
        self.assertLess(model.trained_through,history()[-1].time_utc)

    def test_no_false_ai_improvement_from_only_constant_station_offset(self):
        rows=history(with_real_relation=False)
        with self.assertRaisesRegex(CalibrationRejected,"no-heldout-improvement"):
            fit_station("flat-bias-test",rows)

    def test_datum_and_observation_quality_are_mandatory(self):
        from dataclasses import replace
        rows=history()
        rows[3]=replace(rows[3],datum_aligned=False)
        with self.assertRaisesRegex(CalibrationRejected,"datum"):
            fit_station("bad-datum",rows)
        rows=history()
        rows[5]=replace(rows[5],quality_verified=False)
        with self.assertRaisesRegex(CalibrationRejected,"quality"):
            fit_station("bad-quality",rows)

    def test_never_fit_to_few_days_duplicate_times_or_corrupt_values(self):
        from dataclasses import replace
        with self.assertRaisesRegex(CalibrationRejected,"insufficient"):
            fit_station("too-few",history(2))
        rows=history()
        rows[3]=replace(rows[3],time_utc=rows[2].time_utc)
        with self.assertRaisesRegex(CalibrationRejected,"duplicate"):
            fit_station("duplicate",rows)
        rows=history()
        rows[0]=replace(rows[0],observed_m=float("nan"))
        with self.assertRaisesRegex(CalibrationRejected,"invalid"):
            fit_station("invalid",rows)

    def test_reject_future_observation_leakage_and_missing_forecast_issue(self):
        from dataclasses import replace
        rows=history()
        rows[0]=replace(rows[0],meteo_issued_at_utc=None)
        with self.assertRaisesRegex(CalibrationRejected,"forecast-issue-time"):
            fit_station("missing-issued-forecast",rows)
        rows=history()
        rows[7]=replace(rows[7],meteo_issued_at_utc=rows[7].time_utc)
        with self.assertRaisesRegex(CalibrationRejected,"forecast-issue-time"):
            fit_station("uses-weather-measured-after-target",rows)
        rows=history()
        rows[3]=replace(rows[3],meteo_source=None)
        with self.assertRaisesRegex(CalibrationRejected,"feature-provenance"):
            fit_station("missing-meteo-source",rows)

    def test_uncertain_forecast_features_cannot_generate_ai_prediction(self):
        model=fit_station("validated-test",history())
        with self.assertRaisesRegex(CalibrationRejected,"meteorological"):
            model.correction(2000,0,0)


if __name__=="__main__":
    unittest.main()
