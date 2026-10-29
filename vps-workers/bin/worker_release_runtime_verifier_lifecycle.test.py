"""Transient-unit drain, timeout, and no-false-receipt regressions."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_lifecycle import AuthenticatedRun
from worker_release_runtime_verifier import (
    RuntimeVerificationRejected,
    RuntimeVerificationQuiescenceUnproven,
    validate_runtime_receipt,
    verify_materialized_candidate,
)
from worker_release_runtime_verifier_test_support import cleanup_candidate_after_verifier

SHA = "a" * 40
ARCHIVE = "b" * 64


def identity() -> AuthenticatedRun:
    return AuthenticatedRun(repository="ogabasseyy/Baci",
                            workflow=".github/workflows/production-release.yml",
                            ref="refs/heads/main", sha=SHA, run_id="234",
                            run_attempt=1, job_id="567", status="in_progress")


def freeze(path: Path, gid: int) -> None:
    for current, directories, files in os.walk(path, topdown=False, followlinks=False):
        for name in files:
            child = Path(current) / name
            info = child.lstat()
            os.chown(child, os.geteuid(), gid)
            os.chmod(child, 0o550 if info.st_mode & 0o111 else 0o440)
        for name in directories:
            child = Path(current) / name
            os.chown(child, os.geteuid(), gid)
            os.chmod(child, 0o550)
    os.chown(path, os.geteuid(), gid)
    os.chmod(path, 0o550)


class RuntimeVerifierLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.parent = Path(self.temporary.name) / "releases"
        self.parent.mkdir(mode=0o700)
        self.releases_root_patch = patch("worker_release_candidate_pin.RELEASES_ROOT", self.parent)
        self.releases_root_patch.start()
        self.candidate = self.parent / f".{SHA}.incoming.{('c' * 32)}"
        self.candidate.mkdir(mode=0o700)
        (self.candidate / "apps" / "web" / "node_modules" / ".bin").mkdir(parents=True)
        (self.candidate / "vps-workers" / "bin").mkdir(parents=True)
        (self.candidate / "node_modules" / "dotenv").mkdir(parents=True)
        tsx = self.candidate / "apps" / "web" / "node_modules" / ".bin" / "tsx"
        tsx.write_text("#!/bin/sh\nprintf 'tsx 1.2.3\\n'\n")
        tsx.chmod(0o755)
        (self.candidate / "vps-workers" / "bin" / "worker.mjs").write_text("export {};\n")
        (self.candidate / "node_modules" / "dotenv" / "package.json").write_text(
            '{"name":"dotenv","type":"module","exports":"./index.js"}\n')
        (self.candidate / "node_modules" / "dotenv" / "index.js").write_text(
            "export function config() { return {}; }\n")
        freeze(self.candidate, os.getgid())

    def tearDown(self):
        self.releases_root_patch.stop()
        for current, directories, _files in os.walk(self.temporary.name, topdown=True, followlinks=False):
            os.chmod(current, 0o700)
            for name in directories:
                child = Path(current) / name
                if not child.is_symlink():
                    os.chmod(child, 0o700)
        self.temporary.cleanup()

    @patch("worker_release_runtime_verifier.drain_unpinned_until_proven")
    @patch("worker_release_runtime_verifier.preflight_cgroup_root")
    @patch("worker_release_runtime_verifier._systemctl")
    @patch("worker_release_runtime_verifier._spawn_unit")
    def test_unit_cleanup_and_empty_cgroup_proof_run_after_success(self, spawn, query,
                                                                  _preflight, drain):
        from worker_release_runtime_verifier import _execute_fixed_unit

        class Launcher:
            returncode = 0

            @staticmethod
            def wait(timeout=None):
                return 0

            @staticmethod
            def poll():
                return 0

        spawn.return_value = Launcher()
        unit = "baci-worker-runtime-ffffffffffffffff-aaaaaaaaaaaa-0.service"
        values = {
            "LoadState": "loaded", "ActiveState": "active", "SubState": "exited",
            "Result": "success", "ExecMainCode": "exited", "ExecMainStatus": "0",
            "MainPID": "0", "ControlGroup": f"/system.slice/{unit}",
        }
        query.side_effect = lambda *args, **_kwargs: values[
            next(item.split("=", 1)[1] for item in args if item.startswith("--property="))]
        with patch("worker_release_runtime_verifier.sys.platform", "linux"), \
                patch("worker_release_runtime_verifier.os.geteuid", return_value=0), \
                patch("worker_release_runtime_verifier.SYSTEMD_RUN", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier.SYSTEMCTL", "/usr/bin/true"):
            _execute_fixed_unit(unit, self.candidate, ("/usr/bin/true",),
                                {"PrivateNetwork": "yes"}, 1)
        launch_args = spawn.call_args.args[0]
        self.assertIn("--no-block", launch_args)
        self.assertNotIn("--collect", launch_args)
        self.assertIn("--property=RemainAfterExit=yes", launch_args)
        self.assertIn("--property=StandardOutput=null", launch_args)
        self.assertIn("--property=StandardError=null", launch_args)
        drain.assert_called_once()

    @patch("worker_release_runtime_verifier.drain_unpinned_until_proven")
    @patch("worker_release_runtime_verifier.preflight_cgroup_root")
    @patch("worker_release_runtime_verifier._systemctl")
    @patch("worker_release_runtime_verifier._spawn_unit")
    def test_failed_unit_is_reset_only_after_drain_proves_cgroup_absent(
            self, spawn, systemctl, _preflight, drain):
        from worker_release_runtime_verifier import _execute_fixed_unit

        class Launcher:
            returncode = 0

            @staticmethod
            def wait(timeout=None):
                return 0

            @staticmethod
            def poll():
                return 0

        spawn.return_value = Launcher()
        unit = "baci-worker-runtime-ffffffffffffffff-aaaaaaaaaaaa-0.service"
        state = {"load": "loaded"}

        def show(*args, timeout=1):
            prop = next(item.split("=", 1)[1] for item in args if item.startswith("--property="))
            if prop == "LoadState":
                return state["load"]
            if prop == "ActiveState":
                return "failed"
            if prop == "SubState":
                return "failed"
            if prop == "ExecMainStatus":
                return "21"
            raise AssertionError(f"unexpected property {prop}")

        def fake_systemctl(*args, timeout=1):
            if args[0] == "reset-failed":
                state["load"] = "not-found"
                return ""
            return show(*args, timeout=timeout)

        def drain_after_absent_cgroup(_unit, _process, **kwargs):
            # The real drain helper reaches its query only after the exact
            # cgroup lookup returned UnitCgroupAbsent.
            self.assertEqual(kwargs["query"]("show", "--property=LoadState", "--value", unit),
                             "not-found")

        systemctl.side_effect = fake_systemctl
        drain.side_effect = drain_after_absent_cgroup
        with patch("worker_release_runtime_verifier.sys.platform", "linux"), \
                patch("worker_release_runtime_verifier.os.geteuid", return_value=0), \
                patch("worker_release_runtime_verifier.SYSTEMD_RUN", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier.SYSTEMCTL", "/usr/bin/true"):
            with self.assertRaisesRegex(RuntimeVerificationRejected, "exit=21"):
                _execute_fixed_unit(unit, self.candidate, ("/usr/bin/false",), {}, 1)
        reset_index = next(i for i, call in enumerate(systemctl.call_args_list)
                           if call.args[:2] == ("reset-failed", unit))
        failed_state_index = next(i for i, call in enumerate(systemctl.call_args_list)
                                  if call.args[:3] == ("show", "--property=ActiveState", "--value"))
        self.assertLess(failed_state_index, reset_index)
        self.assertEqual(state["load"], "not-found")

    @patch("worker_release_runtime_verifier.drain_unpinned_until_proven")
    @patch("worker_release_runtime_verifier.preflight_cgroup_root")
    @patch("worker_release_runtime_verifier._systemctl")
    @patch("worker_release_runtime_verifier._spawn_unit")
    def test_launcher_timeout_still_stops_exact_unit_before_return(self, spawn, _query,
                                                                  _preflight, drain):
        from subprocess import TimeoutExpired
        from worker_release_runtime_verifier import _execute_fixed_unit

        class Launcher:
            returncode = None
            pid = 12345

            @staticmethod
            def wait(timeout=None):
                raise TimeoutExpired("systemd-run", timeout)

            def poll(self):
                return self.returncode

        spawn.return_value = Launcher()
        unit = "baci-worker-runtime-ffffffffffffffff-aaaaaaaaaaaa-0.service"
        with patch("worker_release_runtime_verifier.sys.platform", "linux"), \
                patch("worker_release_runtime_verifier.os.geteuid", return_value=0), \
                patch("worker_release_runtime_verifier.SYSTEMD_RUN", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier.SYSTEMCTL", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier._kill_launcher",
                      side_effect=lambda process: setattr(process, "returncode", -9)):
            with self.assertRaisesRegex(RuntimeVerificationRejected, "launch timed out"):
                _execute_fixed_unit(unit, self.candidate, ("/usr/bin/true",), {}, 1)
        drain.assert_called_once()
        self.assertEqual(drain.call_args.args[0], unit)

    @patch("worker_release_runtime_verifier._run_fixed_smokes",
           side_effect=RuntimeVerificationQuiescenceUnproven("unit empty state unproven"))
    def test_unproven_quiescence_marks_candidate_preserve_required(self, _smokes):
        with self.assertRaises(RuntimeVerificationQuiescenceUnproven) as raised:
            verify_materialized_candidate(
                self.candidate, identity(), archive_sha256=ARCHIVE,
                owner_uid=os.geteuid(), owner_gid=os.getgid())
        self.assertTrue(raised.exception.preserve_candidate_required)

    @patch("worker_release_runtime_verifier.drain_unpinned_until_proven",
           side_effect=RuntimeVerificationQuiescenceUnproven("cgroup emptiness unproven"))
    @patch("worker_release_runtime_verifier.preflight_cgroup_root")
    @patch("worker_release_runtime_verifier._spawn_unit")
    def test_unit_cleanup_failure_propagates_preserve_candidate(self, spawn, _preflight, drain):
        from worker_release_runtime_verifier import _execute_fixed_unit

        class RejectedLauncher:
            returncode = 1

            @staticmethod
            def wait(timeout=None):
                return 1

            @staticmethod
            def poll():
                return 1

        spawn.return_value = RejectedLauncher()
        with patch("worker_release_runtime_verifier.sys.platform", "linux"), \
                patch("worker_release_runtime_verifier.os.geteuid", return_value=0), \
                patch("worker_release_runtime_verifier.SYSTEMD_RUN", "/usr/bin/true"), \
                patch("worker_release_runtime_verifier.SYSTEMCTL", "/usr/bin/true"):
            with self.assertRaises(RuntimeVerificationQuiescenceUnproven) as raised:
                _execute_fixed_unit(
                    "baci-worker-runtime-ffffffffffffffff-aaaaaaaaaaaa-0.service",
                    self.candidate, ("/usr/bin/true",), {}, 1)
        self.assertTrue(raised.exception.preserve_candidate_required)
        drain.assert_called_once()

    def test_test_cleanup_preserves_candidate_when_quiescence_is_unproven(self):
        error = RuntimeVerificationQuiescenceUnproven("cgroup empty proof missing")
        self.assertFalse(cleanup_candidate_after_verifier(self.candidate, error))
        self.assertTrue(self.candidate.exists())
        self.assertTrue(cleanup_candidate_after_verifier(self.candidate, None))
        self.assertFalse(self.candidate.exists())

    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux")
                         and os.environ.get("WORKER_RELEASE_RUNTIME_REQUIRE_SYSTEMD") == "1",
                         "requires disposable root/systemd CI")
    def test_actual_timeout_kills_descendant_and_proves_unit_empty(self):
        if not Path("/usr/bin/node").is_file():
            self.fail("disposable Linux verifier job requires /usr/bin/node")
        from worker_release_runtime_verifier import _execute_fixed_unit
        from worker_release_runtime_verifier import _systemctl
        from worker_release_dependency_supervisor_cgroup import drain_unpinned_until_proven
        releases = Path("/srv/baci-workers/releases")
        candidate = releases / f".{SHA}.incoming.{uuid.uuid4().hex}"
        shutil.copytree(self.candidate, candidate, copy_function=shutil.copy2)
        tsx = candidate / "apps" / "web" / "node_modules" / ".bin" / "tsx"
        tsx.chmod(0o700)
        tsx.write_text("#!/bin/sh\n/usr/bin/sleep 60 &\nwait\n")
        tsx.chmod(0o550)
        unproven_error = None
        try:
            unit = "baci-worker-runtime-eeeeeeeeeeeeeeee-ffffffffffff-0.service"
            with patch("worker_release_candidate_pin.RELEASES_ROOT", releases), \
                    patch("worker_release_runtime_verifier.MAX_CHECK_SECONDS", 2), \
                    patch("worker_release_runtime_verifier.drain_unpinned_until_proven",
                          wraps=drain_unpinned_until_proven) as drain:
                try:
                    _execute_fixed_unit(
                        unit, candidate / "apps" / "web",
                        ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                         str(tsx), "--version"),
                        {"User": "65534", "Group": "65534", "PrivateNetwork": "yes",
                         "ProtectSystem": "strict", "PrivateTmp": "no",
                         "InaccessiblePaths": "/tmp /var/tmp /dev/shm",
                         "ReadOnlyPaths": str(candidate), "RuntimeMaxSec": "2",
                         "TasksMax": "32", "MemoryMax": str(512 * 1024 * 1024)}, 1)
                except RuntimeVerificationQuiescenceUnproven:
                    raise
                except RuntimeVerificationRejected:
                    pass
                else:
                    self.fail("timed-out descendant smoke unexpectedly succeeded")
                drain.assert_called_once()
                self.assertEqual(
                    _systemctl("show", "--property=LoadState", "--value", unit), "not-found")
        except RuntimeVerificationQuiescenceUnproven as error:
            unproven_error = error
            raise
        finally:
            cleanup_candidate_after_verifier(candidate, unproven_error)

    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux")
                         and os.environ.get("WORKER_RELEASE_RUNTIME_REQUIRE_SYSTEMD") == "1",
                         "requires disposable root/systemd CI")
    def test_actual_failed_unit_is_unloaded_after_cgroup_proof(self):
        from worker_release_runtime_verifier import _execute_fixed_unit, _systemctl

        unit = f"baci-worker-runtime-{uuid.uuid4().hex[:16]}-{uuid.uuid4().hex[:12]}-0.service"
        with patch("worker_release_runtime_verifier.MAX_CLEANUP_SECONDS", 10):
            with self.assertRaisesRegex(RuntimeVerificationRejected, "exit=1"):
                _execute_fixed_unit(unit, self.candidate, ("/usr/bin/false",),
                                    {"User": "65534", "Group": "65534",
                                     "PrivateNetwork": "yes", "ProtectSystem": "strict",
                                     "ReadOnlyPaths": str(self.candidate),
                                     "TasksMax": "16"}, 1)
        self.assertEqual(_systemctl("show", "--property=LoadState", "--value", unit),
                         "not-found")


if __name__ == "__main__":
    unittest.main()
