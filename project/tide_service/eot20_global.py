"""Global ocean astronomical tide via official PyFES and independent EOT20 atlas.

EOT20 is an OPEN (CC BY 4.0) global 1/8-degree ocean harmonic model
distributed by DGFI-TUM/SEANOE (DOI 10.17882/79489). This is not FES2022b.
Files are NOT bundled or downloaded by the app. The operator must install
the 17 real 'ocean_tides' NetCDF constituent grids, prepare an integrity-
checked PyFES config, and validate tide timing against reference gauges.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
from typing import Callable

from .fes2022_predict import TideUnavailable, predict, regional_bounds

EOT20_NAMES = (
    "2N2", "J1", "K1", "K2", "M2", "M4", "MF", "MM", "N2",
    "O1", "P1", "Q1", "S1", "S2", "SA", "SSA", "T2",
)
EOT20_DOI = "https://doi.org/10.17882/79489"
EOT20_CITATION = (
    "Hart-Davis et al. (2021), EOT20, Earth System Science Data "
    "13, 3869-3884, https://doi.org/10.5194/essd-13-3869-2021"
)
PYFES_NAME = {"MF": "Mf", "MM": "Mm", "SA": "Sa", "SSA": "Ssa"}
MAX_CONFIG_BYTES = 16384


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for block in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atlas_files(directory: str | Path) -> dict[str, Path]:
    root = Path(directory).resolve()
    if not root.is_dir():
        raise TideUnavailable("eot20-atlas-directory-required")
    files = {
        name: root / f"{name}_ocean_eot20.nc" for name in EOT20_NAMES
    }
    # Do not accept a partial/demo atlas, radial loading grids, or a
    # renamed station-only dataset in place of a global ocean elevation.
    if not all(path.is_file() and path.stat().st_size > 1_000_000
               for path in files.values()):
        raise TideUnavailable("eot20-17-global-ocean-files-required")
    return files


def check_grid_metadata(path: Path, reader: Callable | None = None) -> None:
    """Inspect actual NetCDF geometry, coordinate and units without bulk reads."""
    if reader is None:
        try:
            from netCDF4 import Dataset
        except ImportError as exc:
            raise TideUnavailable("netcdf4-required-for-eot20-verification") from exc
        reader = Dataset
    try:
        with reader(str(path), "r") as ds:
            # EOT20 ocean elevation files follow the FES-NetCDF convention,
            # with Greenwich lag in degrees and amplitude in centimetres.
            if not all(name in ds.variables for name in
                       ("lat", "lon", "amplitude", "phase")):
                raise TideUnavailable("eot20-fes-netcdf-fields-required")
            lat, lon = ds.variables["lat"], ds.variables["lon"]
            amp, phase = ds.variables["amplitude"], ds.variables["phase"]
            if not (len(lat) >= 1200 and len(lon) >= 2400 and
                    len(amp.shape) >= 2 and amp.shape == phase.shape and
                    len(amp.shape) == 2 and amp.shape == (len(lat), len(lon))):
                raise TideUnavailable("eot20-not-full-global-grid")
            # Load only few positions from the coordinate axes (not a GB grid).
            if not (-90 <= float(lat[0]) <= -80 and 80 <= float(lat[-1]) <= 90
                    and math.isfinite(float(lon[0])) and
                    float(lon[-1]) - float(lon[0]) >= 350):
                raise TideUnavailable("eot20-not-global-coordinate-extent")
            # Never interpret metres or unknown amplitude units as cm.
            if str(getattr(amp, "units", "")).strip().lower() not in (
                "cm", "centimeter", "centimeters", "centimetre", "centimetres"
            ) or str(getattr(phase, "units", "")).strip().lower() not in (
                "degrees", "degree", "degrees_east", "deg"
            ):
                raise TideUnavailable("eot20-atlas-units-unverified")
    except (OSError, IndexError, TypeError) as exc:
        raise TideUnavailable("eot20-grid-metadata-invalid") from exc


def prepare_eot20(root: str, config_file: str, manifest_file: str,
                  check: Callable[[Path], None] = check_grid_metadata) -> None:
    """Run in an operator-owned directory; preparation is never on Android."""
    try:
        import yaml
    except ImportError as exc:
        raise TideUnavailable("pyyaml-required") from exc
    files = atlas_files(root)
    for path in files.values():
        check(path)
    config = {
        "engine": "darwin",
        "tide": {"cartesian": {
            "latitude": "lat", "longitude": "lon",
            "amplitude": "amplitude", "phase": "phase",
            "paths": {PYFES_NAME.get(name, name): str(path)
                      for name, path in files.items()}
        }},
    }
    config_bytes = yaml.safe_dump(config, sort_keys=True).encode("utf-8")
    if len(config_bytes) > MAX_CONFIG_BYTES:
        raise TideUnavailable("eot20-config-too-large")
    path = Path(config_file).resolve()
    manifest_path = Path(manifest_file).resolve()
    if path == manifest_path:
        raise TideUnavailable("eot20-manifest-config-collision")
    # Files and hashes are operator-owned, never committed to GitHub.
    for destination, data in ((path, config_bytes),):
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as fp:
            fp.write(data)
    manifest = {
        "edition": "EOT20", "provider": "DGFI-TUM",
        "source": EOT20_DOI, "license": "CC-BY-4.0",
        "quantity": "ocean_tide_height", "datum": "atlas_msl",
        "units": "cm", "constituents": len(files),
        "config_sha256": sha256(path),
        "files": [{"path": str(f), "sha256": sha256(f)}
                  for f in files.values()],
    }
    fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fp:
        json.dump(manifest, fp, separators=(",", ":"))


def verify_eot20_manifest(config_file: str, manifest_file: str) -> None:
    config = Path(config_file).resolve()
    manifest = Path(manifest_file).resolve()
    if not config.is_file() or not manifest.is_file():
        raise TideUnavailable("eot20-config-and-manifest-required")
    try:
        meta = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise TideUnavailable("eot20-manifest-invalid") from exc
    if (not isinstance(meta, dict) or meta.get("edition") != "EOT20"
            or meta.get("provider") != "DGFI-TUM"
            or meta.get("source") != EOT20_DOI
            or meta.get("license") != "CC-BY-4.0"
            or meta.get("datum") != "atlas_msl"
            or meta.get("units") != "cm"
            or meta.get("quantity") != "ocean_tide_height"
            or meta.get("constituents") != len(EOT20_NAMES)
            or meta.get("config_sha256") != sha256(config)):
        raise TideUnavailable("eot20-edition-or-config-unverified")
    files = meta.get("files")
    if not isinstance(files, list) or len(files) != len(EOT20_NAMES):
        raise TideUnavailable("eot20-constituent-manifest-incomplete")
    expected = {x.name for x in atlas_files(Path(files[0]["path"]).parent).values()}
    encountered: set[str] = set()
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise TideUnavailable("eot20-file-manifest-invalid")
        p = Path(item["path"]).resolve()
        if (p.name not in expected or str(p) in encountered or
                not isinstance(item.get("sha256"), str) or
                len(item["sha256"]) != 64):
            raise TideUnavailable("eot20-constituent-file-invalid")
        encountered.add(str(p))
        if not p.is_file() or sha256(p) != item["sha256"]:
            raise TideUnavailable("eot20-atlas-integrity-failed")


class PyFESEOT20Atlas:
    """PyFES global ocean tide predictor, with strict source provenance."""
    def __init__(self, config_file: str, manifest_file: str,
                 bbox: tuple[float, float, float, float] | None = None):
        verify_eot20_manifest(config_file, manifest_file)
        try:
            import pyfes
            import numpy as np
            self.config = pyfes.config.load(config_file, bbox=bbox) if bbox else \
                pyfes.config.load(config_file)
            self.model = self.config.models["tide"]
            self.pyfes = pyfes
            self.np = np
            self.bbox = bbox
        except (ImportError, Exception) as exc:
            raise TideUnavailable("eot20-pyfes-atlas-load-failed") from exc

    def __call__(self, times, lat, lon):
        if self.bbox:
            west, south, east, north = self.bbox
            if not west <= lon <= east or not south <= lat <= north:
                raise TideUnavailable("eot20-outside-loaded-region")
        dates = self.np.array([self.np.datetime64(t.replace(tzinfo=None), "s")
                               for t in times])
        lats = self.np.full(len(times), lat, dtype=self.np.float64)
        lons = self.np.full(len(times), lon, dtype=self.np.float64)
        tide, long_period, flags = self.pyfes.evaluate_tide(
            self.model, dates, lons, lats, settings=self.config.settings)
        return zip(tide.tolist(), long_period.tolist(), flags.tolist())


def predict_eot20(lat, lon, start, hours, evaluator) -> dict:
    # The common calculator enforces real 5-min samples, range and flags.
    prediction = predict(lat, lon, start, hours, evaluator)
    prediction["source"] = "EOT20"
    prediction["model_version"] = "EOT20-final"
    prediction["method"] = "PyFES Darwin global astronomical tide"
    prediction["license"] = "CC-BY-4.0"
    prediction["citation"] = EOT20_CITATION
    return prediction


def main() -> int:
    import argparse
    from .fes2022_predict import utc_time
    p = argparse.ArgumentParser(description="Global EOT20/PyFES operator QA")
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--start", required=True)
    p.add_argument("--hours", type=int, default=48)
    p.add_argument("--config", default=os.environ.get("EOT20_CONFIG", ""))
    p.add_argument("--manifest", default=os.environ.get("EOT20_MANIFEST", ""))
    a = p.parse_args()
    try:
        result = predict_eot20(a.lat, a.lon, utc_time(a.start), a.hours,
                  PyFESEOT20Atlas(a.config, a.manifest))
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
        return 0
    except TideUnavailable as exc:
        print(json.dumps({"status": "unavailable", "reason": str(exc),
                          "samples": []}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
