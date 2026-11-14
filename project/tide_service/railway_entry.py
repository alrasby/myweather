"""Managed-TLS ingress for the real EOT20/PyFES tide service.

Railway terminates HTTPS at its managed ingress. Backend listens on private
container HTTP PORT; never advertise HTTP URLs in Android. This entrypoint
never starts unless explicitly enabled and the authentic data's pinned
archive, scientific metadata and cryptographic hashes verify.
"""
from __future__ import annotations

import os
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

from .eot20_bootstrap import provision
from .eot20_global import PyFESEOT20Atlas
from .fes2022_predict import TideUnavailable, regional_bounds
from .gateway import TideGateway, handler_for


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, *args, max_concurrent: int = 24, **kwargs):
        self.slots = threading.BoundedSemaphore(max_concurrent)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            return super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def launch() -> None:
    if os.getenv("TIDE_EOT20_ENABLED") != "1":
        raise TideUnavailable("operator-must-enable-eot20")
    if os.getenv("TIDE_EDGE_TLS_TERMINATED") != "1":
        raise TideUnavailable("managed-https-edge-required")
    if not os.getenv("RAILWAY_ENVIRONMENT_ID"):
        raise TideUnavailable("railway-managed-environment-required")
    port = int(os.environ["PORT"])
    if not 1 <= port <= 65535:
        raise TideUnavailable("invalid-managed-public-port")
    target = Path(os.getenv("EOT20_DATA_DIR", "/data/eot20"))
    config, manifest = provision(target, download=os.getenv("EOT20_DOWNLOAD_PINNED") == "1")
    atlas = PyFESEOT20Atlas(
        str(config), str(manifest), regional_bounds(os.getenv("EOT20_BBOX", ""))
    )
    origins = frozenset(x.strip() for x in
        os.getenv("TIDE_ALLOWED_ORIGINS", "capacitor://localhost,http://localhost").split(",") if x.strip())
    service = TideGateway(atlas, source="EOT20")
    server = BoundedServer(("0.0.0.0", port), handler_for(service, origins),
                           max_concurrent=24)
    print("EOT20_GLOBAL_READY source=EOT20 pyfes=true public_ingress=managed_tls", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == "__main__":
    try:
        launch()
    except (TideUnavailable, KeyError, ValueError, OSError) as exc:
        # Never reveal credentials, file contents, model arrays or user coords.
        print("EOT20_STARTUP_UNAVAILABLE", str(exc)[:140], file=sys.stderr)
        raise SystemExit(2) from None
