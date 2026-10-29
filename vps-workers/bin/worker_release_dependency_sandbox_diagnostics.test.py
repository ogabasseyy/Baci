import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker_release_dependency_diagnostics import PnpmStepRejected
from worker_release_dependency_sandbox import run_pnpm_step, run_sandbox
from worker_release_actual_dependency_guard import MonitorFailure, failure_diagnostic


class SandboxPnpmDiagnosticsTests(unittest.TestCase):
    def test_marker_failure_prints_only_fixed_evidence_metadata(self):
        output = failure_diagnostic("policy-preverify", MonitorFailure(
            "preverify-web-install", "policy-pass-marker-missing", 0,
            {"classification": "absent", "phrase_lines": 0, "recognized_lines": 0},
        ))
        self.assertEqual(output,
                         "experiment failure stage=preverify-web-install category=policy-pass-marker-missing "
                         "exit=0 evidence=absent phrase_lines=0 recognized_lines=0")

    def test_offline_pnpm_error_maps_to_closed_stage_and_category(self):
        failure = subprocess.CalledProcessError(
            1, ("pnpm", "deploy"), output="registry private-token=not-for-logs",
            stderr="ERR_PNPM_LOCKFILE_CONFIG_MISMATCH private-token=not-for-logs",
        )
        with patch("worker_release_dependency_sandbox.subprocess.run", side_effect=failure):
            with self.assertRaises(PnpmStepRejected) as caught:
                run_pnpm_step("web-deploy", ("pnpm", "deploy"), cwd=Path("/tmp"), env={}, timeout=5)
        self.assertEqual((caught.exception.safe_stage, caught.exception.safe_category, caught.exception.exit_code),
                         ("web-deploy", "frozen-lockfile-mismatch", 1))
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)
        self.assertNotIn("private-token", str(caught.exception))

    def test_systemd_failure_reads_only_validated_safe_diagnostic(self):
        with tempfile.TemporaryDirectory() as temporary:
            class FailedProcess:
                returncode = 1

                @staticmethod
                def poll():
                    return 1

            evidence = {"classification": "absent", "phrase_lines": 0, "recognized_lines": 0}
            with patch("worker_release_dependency_sandbox.subprocess.Popen", return_value=FailedProcess()), \
                 patch("worker_release_dependency_sandbox.directory_usage"), \
                 patch("worker_release_dependency_sandbox.read_diagnostic", return_value={
                     "stage": "web-deploy", "category": "dependency-resolution", "exit_code": 1,
                     "evidence": evidence,
                 }), patch("worker_release_dependency_sandbox.stop_unit"):
                with self.assertRaises(PnpmStepRejected) as caught:
                    run_sandbox(("systemd-run",), Path(temporary), "fixture.service", owner_uid=1234)
            self.assertEqual((caught.exception.safe_stage, caught.exception.safe_category),
                             ("web-deploy", "dependency-resolution"))

    def test_unknown_systemd_failure_stays_generic(self):
        with tempfile.TemporaryDirectory() as temporary:
            class FailedProcess:
                returncode = 1

                @staticmethod
                def poll():
                    return 1

            with patch("worker_release_dependency_sandbox.subprocess.Popen", return_value=FailedProcess()), \
                 patch("worker_release_dependency_sandbox.directory_usage"), \
                 patch("worker_release_dependency_sandbox.read_diagnostic", return_value=None), \
                 patch("worker_release_dependency_sandbox.stop_unit"):
                with self.assertRaises(subprocess.CalledProcessError):
                    run_sandbox(("systemd-run",), Path(temporary), "fixture.service", owner_uid=1234)


if __name__ == "__main__":
    unittest.main()
