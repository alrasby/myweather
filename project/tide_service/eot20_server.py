"""Operator-only EOT20/PyFES global tide gateway. No public listener by default.

Run behind an authenticated, rate-limited HTTPS reverse proxy. Model grids
stay on the server, never inside Android APKs. Fail closed when missing.
"""
from __future__ import annotations
import os
from http.server import ThreadingHTTPServer
from ipaddress import ip_address

from .fes2022_predict import TideUnavailable, regional_bounds
from .eot20_global import PyFESEOT20Atlas
from .gateway import TideGateway, handler_for


def listen() -> None:
    if os.environ.get("TIDE_EOT20_ENABLED") != "1":
        raise TideUnavailable("eot20-feature-disabled")
    host = os.environ.get("TIDE_SERVICE_BIND", "127.0.0.1")
    if not ip_address(host).is_loopback:
        raise TideUnavailable("eot20-must-bind-loopback")
    port = int(os.environ.get("TIDE_SERVICE_PORT", "8765"))
    if not 1 <= port <= 65535:
        raise TideUnavailable("eot20-invalid-port")
    atlas = PyFESEOT20Atlas(
        os.environ.get("EOT20_CONFIG", ""),
        os.environ.get("EOT20_MANIFEST", ""),
        regional_bounds(os.environ.get("EOT20_BBOX", "")),
    )
    allowed = frozenset(x.strip() for x in
        os.environ.get("TIDE_ALLOWED_ORIGINS", "").split(",") if x.strip())
    server = ThreadingHTTPServer(
        (host, port), handler_for(TideGateway(atlas, source="EOT20"), allowed))
    server.daemon_threads = True
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


def prepare() -> int:
    """Explicit operator setup after manually installing SEANOE EOT20 files."""
    import argparse
    from .eot20_global import prepare_eot20
    parser = argparse.ArgumentParser(description="Verify and configure global EOT20")
    parser.add_argument("--atlas-dir", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--manifest", required=True)
    args = parser.parse_args()
    try:
        prepare_eot20(args.atlas_dir, args.config, args.manifest)
        print("eot20-global-atlas-verified")
        return 0
    except TideUnavailable as error:
        print("eot20-unavailable:", str(error))
        return 2


if __name__ == "__main__":
    import sys
    if "--prepare" in sys.argv:
        sys.argv.remove("--prepare")
        raise SystemExit(prepare())
    try:
        listen()
    except (TideUnavailable, ValueError) as error:
        print("eot20-service-unavailable:", str(error))
        raise SystemExit(2) from None
