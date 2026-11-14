"""One-time, checksum-pinned EOT20 bootstrap for real PyFES deployments.

The pinned release is a THIRD-PARTY MODIFIED subset of the DGFI-TUM
EOT20 atlas (ocean-tide grids with float32 amplitude/phase). License
CC BY 4.0, attribution: Hart-Davis et al. 2021 / SEANOE 10.17882/79489.
Changes: https://github.com/mattmonkey55-afk/eot20-grids/NOTICE-EOT20.txt

No model files, download URLs or checksums are accepted from HTTP clients.
Operator may instead install unmodified SEANOE grids manually.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import tarfile
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from .eot20_global import EOT20_NAMES, prepare_eot20, verify_eot20_manifest
from .fes2022_predict import TideUnavailable

ARCHIVE_URL = (
    "https://github.com/mattmonkey55-afk/eot20-grids/releases/download/"
    "v1.0.0/eot20-ocean-tides-f4.tar.gz"
)
ARCHIVE_SHA256 = "37dfd1707cd58de9b61a0300768e90f75c6e365461c4376b7a01c9ccd42cf893"
EXPECTED = {f"{name}_ocean_eot20.nc" for name in EOT20_NAMES}
MAX_ARCHIVE_BYTES = 450 * 1024 * 1024
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_UNPACKED_BYTES = 1_800 * 1024 * 1024
CHUNK = 1024 * 1024


def download_verified(path: Path) -> None:
    digest = hashlib.sha256()
    size = 0
    req = Request(ARCHIVE_URL, headers={"User-Agent": "MyWeather-EOT20-Operator/1.0"})
    try:
        with urlopen(req, timeout=75) as response, path.open("xb") as out:
            if response.geturl().split(":", 1)[0] != "https":
                raise TideUnavailable("eot20-download-insecure-redirect")
            while True:
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise TideUnavailable("eot20-download-oversized")
                digest.update(chunk)
                out.write(chunk)
    except (OSError, TimeoutError, ConnectionError) as exc:
        raise TideUnavailable("eot20-download-unavailable") from exc
    if size < 100_000_000 or digest.hexdigest() != ARCHIVE_SHA256:
        raise TideUnavailable("eot20-download-sha256-mismatch")


def extract_verified(archive: Path, output: Path) -> None:
    """Reject traversal, links, hardlinks, duplicates, path tricks, decompression bombs."""
    if output.exists():
        raise TideUnavailable("eot20-atlas-target-already-exists")
    if not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise TideUnavailable("eot20-archive-invalid")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".eot20-", dir=output.parent) as tmp:
        target = Path(tmp) / "ocean_tides"
        target.mkdir()
        total = 0
        seen: set[str] = set()
        try:
            with tarfile.open(archive, mode="r:gz") as tf:
                for entry in tf:
                    if entry.isdir():
                        continue
                    if not entry.isfile() or entry.name.startswith("/") or "\\" in entry.name:
                        raise TideUnavailable("eot20-unsafe-archive-entry")
                    parts = Path(entry.name).parts
                    if ".." in parts or not parts:
                        raise TideUnavailable("eot20-unsafe-archive-path")
                    if parts[-1] == "NOTICE-EOT20.txt" and len(parts) == 1:
                        if not 0 < entry.size < 65536:
                            raise TideUnavailable("eot20-license-notice-size")
                        notice = tf.extractfile(entry)
                        if notice is None:
                            raise TideUnavailable("eot20-license-notice-missing")
                        with notice, (target / "NOTICE-EOT20.txt").open("xb") as note:
                            note.write(notice.read(65536))
                        continue
                    if parts[-1] not in EXPECTED:
                        raise TideUnavailable("eot20-unexpected-archive-entry:" + repr(entry.name[:80]))
                    if parts[-1] in seen or not 1_000_000 < entry.size <= MAX_FILE_BYTES:
                        raise TideUnavailable("eot20-duplicate-or-oversized-grid")
                    seen.add(parts[-1])
                    total += entry.size
                    if total > MAX_UNPACKED_BYTES:
                        raise TideUnavailable("eot20-archive-unpacked-limit")
                    src = tf.extractfile(entry)
                    if src is None:
                        raise TideUnavailable("eot20-archive-corrupt-entry")
                    with src, (target / parts[-1]).open("xb") as dst:
                        copied = 0
                        while True:
                            block = src.read(CHUNK)
                            if not block:
                                break
                            copied += len(block)
                            if copied > entry.size:
                                raise TideUnavailable("eot20-archive-size-mismatch")
                            dst.write(block)
                        if copied != entry.size:
                            raise TideUnavailable("eot20-archive-truncated-grid")
        except (tarfile.TarError, OSError, EOFError) as exc:
            raise TideUnavailable("eot20-archive-extraction-failed") from exc
        if seen != EXPECTED:
            raise TideUnavailable("eot20-17-atlas-grid-files-required")
        target.rename(output)


def provision(root: Path, *, download: bool = False) -> tuple[Path, Path]:
    """Operator setup, never invoked from a user-controlled request."""
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    grids = root / "ocean_tides"
    config, manifest = root / "eot20.yaml", root / "eot20.json"
    if grids.exists() and config.exists() and manifest.exists():
        verify_eot20_manifest(str(config), str(manifest))
        return config, manifest
    if not grids.exists():
        if not download:
            raise TideUnavailable("eot20-grids-not-installed")
        # Prefer volume containing enough free space for 335MB compressed
        # plus 1.8GB uncompressed and scratch.
        if shutil.disk_usage(root).free < 2_700_000_000:
            raise TideUnavailable("eot20-insufficient-storage")
        with tempfile.TemporaryDirectory(prefix=".eot20-download-", dir=root) as tmp:
            archive = Path(tmp) / "source.tar.gz"
            download_verified(archive)
            extract_verified(archive, grids)
    # Fail closed and preserve existing model files on a metadata mismatch.
    prepare_eot20(str(grids), str(config), str(manifest))
    verify_eot20_manifest(str(config), str(manifest))
    return config, manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Install and verify CC BY 4.0 EOT20 globally")
    parser.add_argument("--root", required=True)
    parser.add_argument("--download-pinned-modified", action="store_true")
    args = parser.parse_args()
    try:
        config, manifest = provision(Path(args.root), download=args.download_pinned_modified)
        print("EOT20_VERIFIED_PATHS", config, manifest)
        return 0
    except TideUnavailable as exc:
        print("EOT20_UNAVAILABLE", str(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
