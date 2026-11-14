"""Contract-only tests; no synthetic values are shipped as forecasts."""
import math
import unittest
from datetime import datetime, timedelta, timezone

from tide_service.fes2022_predict import (
    PyFESAtlas, TideUnavailable, extrema, predict, utc_time, verify_official_atlas_manifest, regional_bounds,
)

START = datetime(2026, 11, 14, 0, 0, tzinfo=timezone.utc)


def fixture_model(times, lat, lon):
    # Synthetic test fixture only: real forecasts ONLY through PyFESAtlas.
    return [(100 * math.cos(2 * math.pi * (i * 5 / 60) / 12), 0.0, 4)
            for i, _ in enumerate(times)]


class ScientificTideContract(unittest.TestCase):
    def test_physical_curve_and_high_low_times(self):
        result = predict(23.588, 58.3829, START, 36, fixture_model)
        self.assertEqual(result["source"], "FES2022b")
        self.assertEqual(result["datum"], "atlas_mean_sea_level")
        self.assertEqual(result["height_unit"], "m")
        self.assertEqual(result["status"], "physical_model_unvalidated_at_local_gauge")
        self.assertEqual(len(result["samples"]), 433)
        highs = [x for x in result["extrema"] if x["kind"] == "high"]
        lows = [x for x in result["extrema"] if x["kind"] == "low"]
        self.assertEqual([x["time"] for x in highs],
                         ["2026-11-14T12:00:00Z", "2026-11-15T00:00:00Z"])
        self.assertEqual([x["time"] for x in lows],
                         ["2026-11-14T06:00:00Z", "2026-11-14T18:00:00Z",
                          "2026-11-15T06:00:00Z"])
        self.assertTrue(all(x["time_resolution_minutes"] == 5 for x in result["extrema"]))
        self.assertTrue(result["not_for_navigation"])

    def test_reject_undefined_and_extrapolated_cells(self):
        for flag in (0, -1, -4):
            with self.subTest(flag=flag):
                with self.assertRaisesRegex(TideUnavailable, "extrapolated"):
                    predict(23.588, 58.3829, START, 12,
                            lambda times, *_: [(10, 1, flag) for _ in times])

    def test_no_interpolation_over_missing_or_nonfinite_data(self):
        with self.assertRaisesRegex(TideUnavailable, "incomplete"):
            predict(23.588, 58.3829, START, 12, lambda times, *_: [(1, 1, 4)])
        with self.assertRaisesRegex(TideUnavailable, "nonfinite"):
            predict(23.588, 58.3829, START, 12,
                    lambda times, *_: [(float("nan"), 0, 4) for _ in times])
        with self.assertRaisesRegex(TideUnavailable, "elevation"):
            predict(23.588, 58.3829, START, 12,
                    lambda times, *_: [(4000, 0, 4) for _ in times])

    def test_no_unauthenticated_missing_atlas_fallback(self):
        with self.assertRaisesRegex(TideUnavailable, "atlas-config-required"):
            PyFESAtlas("")
        with self.assertRaisesRegex(TideUnavailable, "atlas-config-required"):
            PyFESAtlas("/not-a-real-fes2022b-config.yaml")

    def test_atlas_must_be_real_verified_full_edition_before_pyfes_load(self):
        import hashlib
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            config = folder / "config.yaml"
            config.write_text("not valid model yaml\n")
            with self.assertRaisesRegex(TideUnavailable, "provenance-manifest-required"):
                PyFESAtlas(str(config))
            manifest = folder / "manifest.json"
            metadata = {"edition": "OLD-DEMO", "producer": "CNES/LEGOS/Noveltis/CLS",
                        "quantity": "ocean_tide_height", "units": "cm",
                        "datum": "atlas_msl", "format": "cartesian-34",
                        "config_sha256": hashlib.sha256(config.read_bytes()).hexdigest(),
                        "files": []}
            manifest.write_text(json.dumps(metadata))
            with self.assertRaisesRegex(TideUnavailable, "edition-or-units"):
                verify_official_atlas_manifest(str(config), str(manifest))
            metadata["edition"] = "FES2022b"
            manifest.write_text(json.dumps(metadata))
            with self.assertRaisesRegex(TideUnavailable, "constituent-atlas-incomplete"):
                verify_official_atlas_manifest(str(config), str(manifest))
            metadata["config_sha256"]="0"*64
            manifest.write_text(json.dumps(metadata))
            with self.assertRaisesRegex(TideUnavailable, "config-hash-mismatch"):
                verify_official_atlas_manifest(str(config), str(manifest))

    def test_region_restrictions_use_real_pyfes_subgrid_without_false_world_claim(self):
        self.assertIsNone(regional_bounds(""))
        self.assertEqual(regional_bounds("52,20,62,28"), (52, 20, 62, 28))
        for bad in ("NaN,20,62,28", "63,20,62,28", "52,20,62,100",
                    "170,-5,-170,5", "0,0,0,0", "broken"):
            with self.subTest(bbox=bad):
                with self.assertRaisesRegex(TideUnavailable,"invalid-fes-region-bbox"):
                    regional_bounds(bad)
        # Verify location gate without loading licensed proprietary model data.
        dummy = PyFESAtlas.__new__(PyFESAtlas)
        dummy.bbox = (52, 20, 62, 28)
        with self.assertRaisesRegex(TideUnavailable,"outside-provisioned-atlas-region"):
            dummy([], 60, 5)

    def test_request_validation_and_utc(self):
        self.assertEqual(utc_time("2026-11-14T00:00:00Z"), START)
        for start in ("2026-11-14T00:01:00Z", "2026-11-14T04:00:00+04:00",
                      "2026-11-14T00:00:00", "invalid"):
            with self.subTest(start=start):
                with self.assertRaises(TideUnavailable):
                    utc_time(start)
        for lat, lon, hours in ((91, 58, 12), (23, 181, 12),
                                (23, 58, 0), (23, 58, 169)):
            with self.subTest(lat=lat, lon=lon, hours=hours):
                with self.assertRaises(TideUnavailable):
                    predict(lat, lon, START, hours, fixture_model)

    def test_no_events_if_model_has_no_turning_points(self):
        series = [{"time": f"t{i}", "level_m": i * 0.1} for i in range(10)]
        self.assertEqual(extrema(series), [])


if __name__ == "__main__":
    unittest.main()
