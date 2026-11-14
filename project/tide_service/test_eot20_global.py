"""EOT20 worldwide service contracts. Synthetic evaluators NEVER deployed."""
from __future__ import annotations
import json
import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from tide_service.eot20_global import (
    EOT20_DOI, EOT20_NAMES, atlas_files, predict_eot20,
    verify_eot20_manifest, check_grid_metadata
)
from tide_service.fes2022_predict import TideUnavailable
from tide_service.gateway import TideGateway, serialized_prediction

START = datetime(2026, 11, 14, tzinfo=timezone.utc)


def fixture(times, lat, lon):
    return [(30 * math.cos(i * math.pi / 72), 0.0, 4)
            for i, _ in enumerate(times)]


class EOT20GlobalContract(unittest.TestCase):
    def test_global_source_keeps_real_pyfes_sample_contract(self):
        p = predict_eot20(23.588, 58.3829, START, 12, fixture)
        self.assertEqual(p["source"], "EOT20")
        self.assertEqual(p["license"], "CC-BY-4.0")
        self.assertEqual(len(p["samples"]), 145)
        self.assertEqual(p["interpolation_points_min"], 4)
        self.assertEqual(p["datum"], "atlas_mean_sea_level")
        self.assertTrue(p["not_for_navigation"])
        self.assertEqual(json.loads(serialized_prediction(p, "EOT20"))["source"], "EOT20")
        with self.assertRaisesRegex(TideUnavailable, "unverified"):
            serialized_prediction(p, "FES2022b")

    def test_gateway_cannot_mislabel_real_eot20_as_fes(self):
        g = TideGateway(fixture, source="EOT20")
        code, data = g.response(23.588, 58.3829, START, 12)
        self.assertEqual(code, 200)
        model = json.loads(data)
        self.assertEqual(model["source"], "EOT20")
        self.assertEqual(model["method"], "PyFES Darwin global astronomical tide")
        self.assertEqual(model["license"], "CC-BY-4.0")
        with self.assertRaisesRegex(ValueError, "unsupported"):
            TideGateway(fixture, source="EOT20-test")

    def test_missing_global_grids_fails_without_fabricating_samples(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(TideUnavailable, "17-global"):
                atlas_files(folder)
            with self.assertRaisesRegex(TideUnavailable, "config-and-manifest"):
                verify_eot20_manifest(str(Path(folder)/"config.yaml"),
                                       str(Path(folder)/"manifest.json"))
        self.assertEqual(len(EOT20_NAMES), 17)
        self.assertEqual(EOT20_DOI, "https://doi.org/10.17882/79489")

    def test_invalid_or_extrapolated_model_cell_fails(self):
        for flag in (0, -1, -10):
            with self.assertRaisesRegex(TideUnavailable, "extrapolated"):
                predict_eot20(23.588, 58.3829, START, 12,
                              lambda times, *_: [(20, 0, flag) for _ in times])

    def test_no_fake_grid_accepted_as_global(self):
        class Axis:
            def __init__(self, length, low, high):
                self.n, self.low, self.high = length, low, high
            def __len__(self): return self.n
            def __getitem__(self, i): return self.low if i == 0 else self.high
        class Var:
            def __init__(self, shape, units):
                self.shape, self.units = shape, units
        class FakeDS:
            def __init__(self, bad=None):
                self.variables = {
                    "lat": Axis(1441, -90.0, 90.0),
                    "lon": Axis(2880, 0.0, 359.875),
                    "amplitude": Var((1441, 2880), "cm"),
                    "phase": Var((1441, 2880), "degrees"),
                }
                if bad:
                    bad(self.variables)
            def __enter__(self): return self
            def __exit__(self, *args): return None
        check_grid_metadata(Path("dummy.nc"), reader=lambda *a: FakeDS())
        cases = [
            lambda v: v.pop("amplitude"),
            lambda v: setattr(v["amplitude"], "units", "metres"),
            lambda v: setattr(v["lat"], "n", 21),
            lambda v: setattr(v["lon"], "high", 170.0),
        ]
        for bad in cases:
            with self.subTest(bad=bad):
                with self.assertRaisesRegex(TideUnavailable, "eot20-"):
                    check_grid_metadata(Path("dummy.nc"), reader=lambda *a: FakeDS(bad))


if __name__ == "__main__":
    unittest.main()
