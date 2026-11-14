"""Loopback-only, fail-closed PyFES tide prediction gateway.

No atlas, credentials or server are shipped in the Android APK. Operator runs
this behind a separately authenticated, rate-limited TLS reverse proxy after
licensing and independent validation; it is not a public endpoint by default.

Do not trust Origin for authentication: Capacitor native requests omit it.
The gateway binds LOOPBACK ONLY, has a bounded cache/work queue, validates
every query, never serializes model files, and returns no synthetic forecasts.
"""
from __future__ import annotations

import hmac
import json
import os
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from ipaddress import ip_address
from urllib.parse import parse_qs, urlsplit
from typing import Callable

from .fes2022_predict import PyFESAtlas, TideUnavailable, predict, utc_time, validate_position

MAX_BYTES = 300_000
MAX_CACHE_ENTRIES = 96
CACHE_SECONDS = 600
MAX_REQUESTS_PER_MINUTE = 90
MAX_HOURS_HTTP = 72


class BadRequest(ValueError):
    pass


def query_prediction(raw_path: str) -> tuple[float, float, datetime, int]:
    parsed = urlsplit(raw_path)
    if parsed.path != "/v1/tides" or len(raw_path) > 512:
        raise BadRequest("invalid-path")
    query = parse_qs(parsed.query, keep_blank_values=True)
    if set(query) != {"lat", "lon", "start", "hours"} or any(len(v) != 1 for v in query.values()):
        raise BadRequest("invalid-parameters")
    try:
        lat = float(query["lat"][0])
        lon = float(query["lon"][0])
        hours = int(query["hours"][0])
        start = utc_time(query["start"][0])
        validate_position(lat, lon, hours)
        if hours > MAX_HOURS_HTTP:
            raise BadRequest("forecast-window-too-long")
        # Unbounded historical/future time ranges cannot be served in the
        # normal realtime API. Diagnostic offline CLI is separate.
        if abs((start - datetime.now(timezone.utc)).total_seconds()) > 24*3600:
            raise BadRequest("start-outside-live-window")
    except (ValueError, TideUnavailable, KeyError) as exc:
        raise BadRequest("invalid-location-or-time") from exc
    return lat, lon, start, hours


def serialized_prediction(payload: dict) -> bytes:
    if (not isinstance(payload, dict) or payload.get("source") != "FES2022b" or
        payload.get("datum") != "atlas_mean_sea_level" or
        payload.get("height_unit") != "m" or
        payload.get("status") != "physical_model_unvalidated_at_local_gauge" or
        payload.get("not_for_navigation") is not True or
        not isinstance(payload.get("interpolation_points_min"), int) or
        payload["interpolation_points_min"] <= 0 or
        not isinstance(payload.get("samples"), list) or
        len(payload["samples"]) < 12*12):
        raise TideUnavailable("unverified-physical-model-response")
    encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(encoded) > MAX_BYTES:
        raise TideUnavailable("forecast-response-too-large")
    return encoded


class TideGateway:
    def __init__(self, predictor: Callable, *,
                 clock: Callable[[], float] = time.monotonic):
        self.predictor = predictor
        self.clock = clock
        self.cache: OrderedDict[tuple, tuple[float, bytes]] = OrderedDict()
        self.cache_lock = threading.Lock()
        self.one_prediction = threading.BoundedSemaphore(1)
        self.requests: deque[float] = deque()

    def response(self, lat: float, lon: float, start: datetime, hours: int) -> tuple[int, bytes]:
        key = (round(lat, 4), round(lon, 4), start.isoformat(), hours)
        now = self.clock()
        with self.cache_lock:
            while self.requests and now - self.requests[0] >= 60:
                self.requests.popleft()
            if len(self.requests) >= MAX_REQUESTS_PER_MINUTE:
                return 429, b'{"status":"rate_limited"}'
            self.requests.append(now)
            entry = self.cache.get(key)
            if entry and now - entry[0] < CACHE_SECONDS:
                self.cache.move_to_end(key)
                return 200, entry[1]

        if not self.one_prediction.acquire(blocking=False):
            return 503, b'{"status":"busy"}'
        try:
            try:
                # The actual evaluator is operator-owned PyFESAtlas. The HTTP
                # gateway does not accept client-supplied samples or models.
                result = predict(lat, lon, start, hours, self.predictor)
                encoded = serialized_prediction(result)
            except (TideUnavailable, ValueError, TypeError, OverflowError):
                return 503, b'{"status":"unavailable"}'
            with self.cache_lock:
                self.cache[key] = (self.clock(), encoded)
                self.cache.move_to_end(key)
                while len(self.cache) > MAX_CACHE_ENTRIES:
                    self.cache.popitem(last=False)
            return 200, encoded
        finally:
            self.one_prediction.release()


def handler_for(gateway: TideGateway, origins: frozenset[str] = frozenset()):
    class Handler(BaseHTTPRequestHandler):
        # No user coordinates in access logs (do not emit query strings).
        def log_message(self, _format, *_args):
            return

        def _reply(self, status: int, body: bytes, extra: dict | None = None):
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "private, no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Vary", "Origin")
            origin = self.headers.get("Origin", "")
            if origin and origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
            if extra:
                for k, v in extra.items():
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            origin = self.headers.get("Origin", "")
            if origin and origin not in origins:
                self._reply(403, b'{"status":"forbidden"}')
                return
            parsed = urlsplit(self.path)
            if parsed.path == "/healthz" and not parsed.query:
                self._reply(200, b'{"ready":true,"source":"FES2022b","public":false}')
                return
            try:
                lat, lon, start, hours = query_prediction(self.path)
            except BadRequest:
                self._reply(400, b'{"status":"invalid_request"}')
                return
            try:
                code, data = gateway.response(lat, lon, start, hours)
            except Exception:
                # No internal filesystem details, configuration or secrets.
                self._reply(503, b'{"status":"unavailable"}')
                return
            self._reply(code, data, {"Retry-After": "5"} if code in (429, 503) else None)

    return Handler


def listen() -> None:
    if os.environ.get("TIDE_SERVICE_ENABLED") != "1":
        raise TideUnavailable("tide-server-feature-disabled")
    host = os.environ.get("TIDE_SERVICE_BIND", "127.0.0.1")
    if not ip_address(host).is_loopback:
        raise TideUnavailable("tide-server-must-bind-loopback")
    port = int(os.environ.get("TIDE_SERVICE_PORT", "8765"))
    if not 1 <= port <= 65535:
        raise TideUnavailable("invalid-listen-port")
    atlas = PyFESAtlas(os.environ.get("FES2022_CONFIG", ""),
                       os.environ.get("FES2022_MANIFEST", ""))
    origins = frozenset(o.strip() for o in
                        os.environ.get("TIDE_ALLOWED_ORIGINS", "").split(",") if o.strip())
    # A production reverse proxy performs HTTPS, authentication and a much
    # stricter public-IP per-client rate limit; browser Origin is NOT auth.
    server = ThreadingHTTPServer((host, port), handler_for(TideGateway(atlas), origins))
    server.daemon_threads = True
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        listen()
    except (TideUnavailable, ValueError) as error:
        # Do not log config file contents or sensitive paths.
        print("tide-service-unavailable:", str(error))
        raise SystemExit(2) from None
