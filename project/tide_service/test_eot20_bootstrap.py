"""Supply-chain EOT20 archive safety: no remote requests in tests."""
import io
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tide_service.eot20_bootstrap import (
    ARCHIVE_SHA256, ARCHIVE_URL, EXPECTED, extract_verified, provision,
)
from tide_service.fes2022_predict import TideUnavailable


def create_tar(path: Path, items: list[tuple[str, bytes, int]]):
    with tarfile.open(path, "w:gz") as tf:
        for name, data, mode in items:
            obj = tarfile.TarInfo(name)
            obj.type = mode
            obj.size = len(data) if mode == tarfile.REGTYPE else 0
            tf.addfile(obj, io.BytesIO(data) if mode == tarfile.REGTYPE else None)


class PinnedAtlasSupplyChain(unittest.TestCase):
    def test_release_is_pinned_https_and_not_stored_in_apk(self):
        self.assertTrue(ARCHIVE_URL.startswith("https://github.com/"))
        self.assertEqual(len(ARCHIVE_SHA256), 64)
        self.assertEqual(len(EXPECTED), 17)

    def test_provision_refuses_to_download_implicitly(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(TideUnavailable, "not-installed"):
                provision(Path(tmp), download=False)

    def test_archive_traversal_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name,mode in [
                ("../../escape.txt", tarfile.REGTYPE),
                ("/tmp/escape.txt", tarfile.REGTYPE),
                ("M2_ocean_eot20.nc", tarfile.SYMTYPE),
                ("EOT20/../../M2_ocean_eot20.nc", tarfile.REGTYPE),
            ]:
                p = root / "bad.tar.gz"
                create_tar(p, [(name, b"abc", mode)])
                with self.assertRaises(TideUnavailable):
                    extract_verified(p, root / "ocean_tides")
                self.assertFalse((root / "ocean_tides").exists())

    def test_rejects_missing_constituents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p = root / "empty.tar.gz"
            create_tar(p, [("NOTICE-EOT20.txt", b"CC BY 4.0", tarfile.REGTYPE)])
            with self.assertRaisesRegex(TideUnavailable, "17-atlas"):
                extract_verified(p, root / "ocean_tides")
            self.assertFalse((root / "ocean_tides").exists())

    def test_no_operator_model_dir_alias_from_client_request(self):
        from tide_service.gateway import query_prediction, BadRequest
        with self.assertRaises(BadRequest):
            query_prediction("/v1/tides?lat=0&lon=0&hours=12&start=x&atlas_url=https://x")

    def test_runtime_requires_managed_tls_and_explicit_enable(self):
        import os
        from tide_service.railway_entry import launch
        with patch.dict(os.environ, {"TIDE_EOT20_ENABLED": "0", "TIDE_EDGE_TLS_TERMINATED": "1"}):
            with self.assertRaisesRegex(TideUnavailable, "operator-must-enable"):
                launch()
        with patch.dict(os.environ, {"TIDE_EOT20_ENABLED": "1", "TIDE_EDGE_TLS_TERMINATED": "0"}):
            with self.assertRaisesRegex(TideUnavailable, "managed-https"):
                launch()


if __name__ == "__main__":
    unittest.main()
