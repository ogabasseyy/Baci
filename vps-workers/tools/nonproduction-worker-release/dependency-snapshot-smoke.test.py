import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("dependency-snapshot-smoke.py")
SPEC = importlib.util.spec_from_file_location("dependency_snapshot_smoke", SCRIPT)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


class DependencySnapshotSmokeTests(unittest.TestCase):
    def test_snapshot_layout_failure_reports_only_category_and_relative_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "safe").mkdir()
            (root / "safe" / "file").write_text("synthetic", encoding="utf-8")
            (root / "escape").symlink_to(root / "safe", target_is_directory=True)

            with self.assertRaises(smoke.SmokeFailure) as failure:
                smoke.snapshot_digest(root, "fixture")
            self.assertEqual(failure.exception.category, "fixture-symlink")
            self.assertEqual(failure.exception.relative, "escape")

    def test_failed_synthetic_tsx_reports_stage_and_exit_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            web = root / "apps/web/node_modules/.bin"
            web.mkdir(parents=True)
            (web / "tsx").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            (root / "node_modules/dotenv").mkdir(parents=True)
            argv = [str(SCRIPT), str(root)]
            with patch.object(smoke.sys, "argv", argv), patch.object(smoke.os, "geteuid", return_value=1001), \
                 patch.object(smoke.os.path, "isfile", return_value=True), patch.object(smoke.os, "access", return_value=True), \
                 patch.object(smoke.subprocess, "run", side_effect=subprocess.CalledProcessError(17, ["synthetic-secret-command"])):
                from contextlib import redirect_stderr
                from io import StringIO
                output = StringIO()
                with redirect_stderr(output):
                    result = smoke.main()
            self.assertEqual(result, 1)
            self.assertEqual(output.getvalue(), "dependency-smoke-failure category=tsx-execution-exit-17\n")


if __name__ == "__main__":
    unittest.main()
