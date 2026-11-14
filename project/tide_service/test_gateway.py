"""Offline HTTP tests use injected SYNTHETIC fixtures, never as public forecasts."""
import json
import math
import threading
import unittest
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from tide_service.gateway import (
    BadRequest, TideGateway, handler_for, query_prediction,
)


def fake_atlas(times, lat, lon):
    return [(75*math.cos(i * math.pi / 72), 0.0, 4)
            for i, _ in enumerate(times)]


def current_start():
    now = datetime.now(timezone.utc)
    return now.replace(minute=(now.minute//5)*5, second=0, microsecond=0)


def query(**changes):
    args = {"lat": "23.588", "lon": "58.3829",
            "start": current_start().isoformat(), "hours": "12"}
    args.update(changes)
    return "/v1/tides?" + urlencode(args)


class HttpGatewayContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gateway = TideGateway(fake_atlas)
        cls.server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            handler_for(cls.gateway, frozenset({"https://weather.example.test"}))
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def get(self, path, headers=None):
        req = Request(f"http://127.0.0.1:{self.server.server_port}{path}",
                      headers=headers or {})
        try:
            with urlopen(req, timeout=3) as resp:
                return resp.status, json.loads(resp.read()), resp.headers
        except HTTPError as error:
            return error.code, json.loads(error.read()), error.headers

    def test_real_endpoint_contract_is_explicitly_unvalidated(self):
        status, body, headers = self.get(query())
        self.assertEqual(status, 200)
        self.assertEqual(body["source"], "FES2022b")
        self.assertEqual(body["status"], "physical_model_unvalidated_at_local_gauge")
        self.assertEqual(body["datum"], "atlas_mean_sea_level")
        self.assertEqual(len(body["samples"]), 145)
        self.assertEqual(body["interpolation_points_min"], 4)
        self.assertTrue(body["not_for_navigation"])
        self.assertEqual(headers["Cache-Control"], "private, no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertLess(len(json.dumps(body)), 300_000)

    def test_valid_origin_is_returned_exactly_unknown_origin_is_denied(self):
        ok, _, headers = self.get(query(), {"Origin": "https://weather.example.test"})
        self.assertEqual(ok, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://weather.example.test")
        code, body, headers = self.get(query(), {"Origin": "https://attacker.example"})
        self.assertEqual(code, 403)
        self.assertEqual(body, {"status": "forbidden"})
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_invalid_queries_fail_without_data_or_internal_details(self):
        for bad in [
            "/v1/tides", "/v1/tides?lat=1", query(lat="NaN"),
            query(lat="123"), query(lon="-181"), query(hours="100"),
            query(hours="0"), query(hours="2.1"), query(start="now"),
            query(lat="23.6&lat=42"), query(foo="bar"),
        ]:
            with self.subTest(path=bad):
                code, body, _ = self.get(bad)
                self.assertEqual(code, 400)
                self.assertEqual(body, {"status": "invalid_request"})
        with self.assertRaises(BadRequest):
            query_prediction(query(start="2001-01-01T00:00:00Z"))

    def test_cache_reuses_exact_location_and_separate_coordinates_get_new_key(self):
        calls = []
        def counted(times, lat, lon):
            calls.append((lat, lon))
            return fake_atlas(times, lat, lon)
        g = TideGateway(counted)
        a = current_start()
        code, body = g.response(23.588, 58.3829, a, 12)
        self.assertEqual(code, 200)
        self.assertEqual(g.response(23.588, 58.3829, a, 12)[1], body)
        g.response(23.589, 58.3829, a, 12)
        self.assertEqual(len(calls), 2)
        self.assertLessEqual(len(g.cache), 96)

    def test_busy_and_nonfinite_model_produce_explicit_unavailable(self):
        g = TideGateway(fake_atlas)
        self.assertTrue(g.one_prediction.acquire(blocking=False))
        try:
            status, body = g.response(23.588, 58.3829, current_start(), 12)
            self.assertEqual((status, body), (503, b'{"status":"busy"}'))
        finally:
            g.one_prediction.release()
        g = TideGateway(lambda times, *_: [(float("nan"), 0, 4) for _ in times])
        status, body = g.response(23.588, 58.3829, current_start(), 12)
        self.assertEqual((status, body), (503, b'{"status":"unavailable"}'))

    def test_health_does_not_claim_calibrated_station_accuracy(self):
        code, response, _ = self.get("/healthz")
        self.assertEqual(code, 200)
        self.assertEqual(response["source"], "FES2022b")
        self.assertFalse(response["public"])
        self.assertNotIn("validated", response)
        self.assertNotIn("gauge", response)


if __name__ == "__main__":
    unittest.main()
