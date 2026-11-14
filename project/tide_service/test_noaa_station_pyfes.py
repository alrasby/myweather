"""Offline NOAA harmonic adapter contracts; no fake samples enter the app."""
import math
import unittest
from datetime import datetime, timezone

from tide_service.fes2022_predict import TideUnavailable
from tide_service.noaa_station_pyfes import (
    load_noaa_station, parse_station_harmonics, predict_noaa_station
)

STATION = {"id": "9414290", "name": "San Francisco, CA",
           "tidal": True, "lat": 37.806, "lng": -122.465}
NAMES = ["M2", "S2", "K1", "O1", "N2", "P1", "Q1", "K2"]


def harmonic():
    return {"units": "meters", "HarmonicConstituents": [
        {"name": name, "amplitude": 0.1 + i * 0.01, "phase_GMT": 70 + i}
        for i, name in enumerate(NAMES)
    ]}


def example_evaluator(constituents, times, lat):
    assert len(constituents) == 8
    assert lat == STATION["lat"]
    assert constituents["M2"][0] == 10.0  # metres -> PyFES centimetres
    return ([20.0 * math.cos(i * math.pi / 72) for i in range(len(times))],
            [0.0] * len(times))


class NOAAStationPyFESContract(unittest.TestCase):
    def test_station_only_with_real_source_metadata_contract(self):
        start = datetime(2026, 11, 14, tzinfo=timezone.utc)
        result = predict_noaa_station("9414290", STATION, harmonic(), start, 12,
                                      evaluator=example_evaluator)
        self.assertEqual(result["source"], "NOAA_COOPS_STATION_HARMONICS")
        self.assertIn("PyFES", result["method"])
        self.assertNotEqual(result["source"], "FES2022b")
        self.assertEqual(len(result["samples"]), 145)
        self.assertEqual(result["station_id"], "9414290")
        self.assertTrue(result["not_for_navigation"])

    def test_noaa_real_collection_shape_and_metadata_request(self):
        import json
        from tide_service.noaa_station_pyfes import NOAA_API
        class FakeResponse:
            def __init__(self, data):
                self.data = json.dumps(data).encode("utf-8")
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return None
            def read(self, n):
                return self.data[:n]
        class FakeOpener:
            def __init__(self):
                self.paths = []
            def open(self, req, timeout):
                self.paths.append(req.full_url)
                if req.full_url.endswith("9414290.json"):
                    return FakeResponse({"count": 1, "stations": [STATION]})
                if req.full_url.endswith("harcon.json?units=metric"):
                    return FakeResponse(harmonic())
                raise AssertionError("unexpected URL")
        opener = FakeOpener()
        station, harcon = load_noaa_station("9414290", opener)
        self.assertEqual(station["id"], "9414290")
        self.assertEqual(len(harcon["HarmonicConstituents"]), 8)
        self.assertEqual(opener.paths, [
            NOAA_API + "9414290.json",
            NOAA_API + "9414290/harcon.json?units=metric",
        ])

    def test_mismatching_or_nontidal_station_fails_closed(self):
        for value in [{**STATION, "id": "9999999"}, {**STATION, "tidal": False}]:
            with self.assertRaisesRegex(TideUnavailable, "unverified"):
                parse_station_harmonics(value, harmonic(), "9414290")

    def test_no_feet_or_missing_major_constituents(self):
        bad = harmonic()
        bad["units"] = "feet"
        with self.assertRaisesRegex(TideUnavailable, "metric"):
            parse_station_harmonics(STATION, bad, "9414290")
        bad = harmonic()
        bad["HarmonicConstituents"][0]["name"] = "A1"
        with self.assertRaisesRegex(TideUnavailable, "major-harmonics"):
            parse_station_harmonics(STATION, bad, "9414290")

    def test_no_bad_phases_or_duplicate_constituents(self):
        for key, value in (("phase_GMT", 361), ("amplitude", float("nan"))):
            bad = harmonic()
            bad["HarmonicConstituents"][0][key] = value
            with self.assertRaises(TideUnavailable):
                parse_station_harmonics(STATION, bad, "9414290")
        bad = harmonic()
        bad["HarmonicConstituents"][2]["name"] = "M2"
        with self.assertRaisesRegex(TideUnavailable, "duplicate"):
            parse_station_harmonics(STATION, bad, "9414290")

    def test_no_incomplete_forecast(self):
        with self.assertRaisesRegex(TideUnavailable, "incomplete"):
            predict_noaa_station("9414290", STATION, harmonic(),
                datetime(2026, 11, 14, tzinfo=timezone.utc), 12,
                evaluator=lambda *args: ([0.0], [0.0]))

    def test_no_random_remote_url_station_identifier(self):
        for station_id in ("../9414290", "http://evil", "abc", "94142901"):
            with self.assertRaisesRegex(TideUnavailable, "invalid-noaa"):
                load_noaa_station(station_id)

    def test_no_data_fabrication_without_pyfes(self):
        bad = harmonic()
        bad["HarmonicConstituents"] = []
        with self.assertRaisesRegex(TideUnavailable, "incomplete"):
            predict_noaa_station("9414290", STATION, bad,
                datetime(2026, 11, 14, tzinfo=timezone.utc), 12)


if __name__ == "__main__":
    unittest.main()
