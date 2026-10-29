"""Disposable root/systemd tests for the dependency-builder cgroup supervisor."""
from __future__ import annotations

import os
import pwd
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_dependency_supervisor as supervisor
import worker_release_dependency_builder as dependency_builder
from worker_release_dependency_supervisor_cgroup import drain_until_proven
from worker_release_descriptor_cgroup import CgroupProofRejected
from worker_release_dependency_supervisor_journal import (
    BuilderJournalRejected, BuilderUnitJournal, recover_recorded_builder,
)

FENCE = {"repository": "org/repo", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": "a" * 40, "run_id": "1", "run_attempt": 1, "job_id": "2"}


def execute_canonical_unit(command, script: str, process_factory):
    """Keep shipped canonical sandbox arguments and replace only payload argv."""
    actual = tuple(command)
    builder_entrypoint = str(Path(supervisor.__file__).with_name(
        "worker_release_dependency_builder.py"))
    entrypoint_index = actual.index(builder_entrypoint)
    safe_command = (*actual[:entrypoint_index - 1], "/usr/bin/python3", "-c", script)
    return process_factory(safe_command, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           env={"PATH": "/usr/bin:/bin"})


@unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux")
                     and os.environ.get("WORKER_RELEASE_BUILDER_SYSTEMD_REQUIRE") == "1",
                     "requires disposable root/systemd/cgroup-v2 workflow")
class BuilderSupervisorSystemdTests(unittest.TestCase):
    def setUp(self):
        if shutil.which("systemctl") is None or os.system("systemctl is-system-running >/dev/null 2>&1") != 0:
            self.fail("CI requires a running systemd manager")
        self.builder = pwd.getpwnam("nobody")
        self.temp = tempfile.TemporaryDirectory(dir="/run")
        self.root = Path(self.temp.name)
        self.root.chmod(0o711)
        self.scratch = self.root / "scratch"
        self.scratch.mkdir(mode=0o700)
        os.chown(self.scratch, self.builder.pw_uid, self.builder.pw_gid)
        self.source = self.root / "source"
        self.source.mkdir(mode=0o555)
        os.chown(self.source, 0, 0)
        (self.root / "pnpm-cache-seed").mkdir(mode=0o555)
        receipt = self.root / ".baci-policy-verification.json"
        receipt.write_text("{}")
        receipt.chmod(0o444)
        self.worker_root = self.root / "worker"
        self.worker_root.mkdir(mode=0o700)

    def tearDown(self):
        self.temp.cleanup()

    def run_unit(self, script: str, *, cap: int = supervisor.MAX_SCRATCH_BYTES):
        unit = f"baci-worker-deps-{'a' * 12}-{'b' * 32}.service"
        with BuilderUnitJournal(self.worker_root, owner_uid=0) as journal:
            journal.begin(FENCE, unit, self.source, self.scratch,
                          self.builder.pw_uid, self.builder.pw_gid)
            canonical = __import__("worker_release_dependency_sandbox").systemd_command(
                self.source, self.scratch, "a" * 40, self.builder.pw_uid,
                self.builder.pw_gid, unit)
            with (patch.object(supervisor, "MAX_SCRATCH_BYTES", cap),
                  patch.object(supervisor, "_spawn_unit",
                               side_effect=lambda _cmd, **kwargs: execute_canonical_unit(
                                   canonical, script,
                                   lambda argv, **kw: subprocess.Popen(argv, **kw)))):
                supervisor.supervise_builder_unit(
                    self.source, self.scratch, "a" * 40, self.builder.pw_uid,
                    self.builder.pw_gid, unit, usage_root=self.scratch,
                    unit_journal=journal,
                )

    def test_success_returns_only_after_unit_cgroup_is_empty(self):
        self.run_unit("import time; time.sleep(0.5)")
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_bound_violation_kills_descendant_and_proves_cgroup_empty(self):
        script = (
            "import subprocess,time,pathlib,os; "
            "subprocess.Popen(['/usr/bin/python3','-c','import time; time.sleep(60)']); "
            "pathlib.Path('" + str(self.scratch / "oversize") + "').write_bytes(b'xx'); "
            "time.sleep(60)"
        )
        with self.assertRaisesRegex(supervisor.BuilderSupervisorRejected, "scratch exceeded"):
            self.run_unit(script, cap=1)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_recovery_requires_terminal_proof_and_drains_recorded_unit(self):
        unit = f"baci-worker-deps-{'a' * 12}-{'c' * 32}.service"
        script = "import subprocess,time; subprocess.Popen(['/usr/bin/python3','-c','import time; time.sleep(60)']); time.sleep(60)"
        command = list(__import__("worker_release_dependency_sandbox").systemd_command(
            self.source, self.scratch, "a" * 40, self.builder.pw_uid,
            self.builder.pw_gid, unit))
        builder_entrypoint = str(Path(supervisor.__file__).with_name(
            "worker_release_dependency_builder.py"))
        command = command[:command.index(builder_entrypoint) - 1] + [
            "/usr/bin/python3", "-c", script,
        ]
        command.remove("--wait")
        command.remove("--pipe")
        with BuilderUnitJournal(self.worker_root, owner_uid=0) as journal:
            journal.begin({"repository": "org/repo", "workflow": "release.yml",
                           "ref": "refs/heads/main", "sha": "a" * 40, "run_id": "1",
                           "run_attempt": 1, "job_id": "2"}, unit, self.source, self.scratch,
                          self.builder.pw_uid, self.builder.pw_gid)
            started = subprocess.run(command, check=True, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            self.assertEqual(started.returncode, 0)
            fence = {"repository": "org/repo", "workflow": "release.yml",
                     "ref": "refs/heads/main", "sha": "a" * 40, "run_id": "1",
                     "run_attempt": 1, "job_id": "2"}
            with self.assertRaisesRegex(BuilderJournalRejected, "terminal-run proof"):
                recover_recorded_builder(journal, fence,
                                         terminal_attempt_proven=lambda _fence: False)
            self.assertEqual(supervisor._systemctl("show", "--property=ActiveState", "--value", unit),
                             "active")
            result = recover_recorded_builder(journal, fence,
                                              terminal_attempt_proven=lambda _fence: True)
            self.assertEqual(result, "drained")
            self.assertEqual(journal.read()["phase"], "drained")


class BuilderSupervisorContractTests(unittest.TestCase):
    def test_unit_name_is_bound_to_sha_prefix_and_random_transaction(self):
        self.assertEqual(
            supervisor._control_group("baci-worker-deps-aaaaaaaaaaaa-" + "b" * 32 + ".service"),
            "/system.slice/baci-worker-deps-aaaaaaaaaaaa-" + "b" * 32 + ".service",
        )
        for invalid in ("baci-worker-deps-aaaaaaaaaaaa.service", "../evil.service",
                        "baci-worker-deps-aaaaaaaaaaaa-" + "b" * 32 + ".scope"):
            with self.subTest(invalid=invalid), self.assertRaises(supervisor.BuilderSupervisorRejected):
                supervisor._control_group(invalid)

    @unittest.skipUnless(os.geteuid() == 0, "requires root-owned builder source fixture")
    def test_builder_runner_rejects_noncanonical_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sha = "a" * 40
            input_root = root / f"{sha}.input.123"
            source, scratch = input_root / "source", root / f"{sha}.456"
            input_root.mkdir()
            source.mkdir()
            scratch.mkdir()
            os.chmod(scratch, 0o700)
            entrypoint = Path(supervisor.__file__).with_name("worker_release_dependency_builder.py")
            unit = f"baci-worker-deps-{sha[:12]}-" + "b" * 32 + ".service"
            expected = ("/usr/bin/systemd-run", "/usr/bin/python3", str(entrypoint),
                        "--sandbox-worker", str(source), str(scratch), sha)
            fence = {"repository": "org/repo", "workflow": "release.yml",
                     "ref": "refs/heads/main", "sha": sha, "run_id": "1",
                     "run_attempt": 1, "job_id": "2"}
            journal = Mock()
            with (patch("worker_release_dependency_builder.BUILD_INPUT_ROOT", root),
                  patch("worker_release_dependency_sandbox.systemd_command",
                        return_value=expected),
                  patch.object(supervisor, "supervise_builder_unit") as run):
                runner = supervisor.fixed_builder_runner(sha, os.getuid(),
                                                         os.getgid(), fence=fence,
                                                         unit_journal=journal, usage_root=root)
                runner(expected, scratch, unit)
                journal.begin.assert_called_once_with(fence, unit, source, scratch,
                                                      os.getuid(), os.getgid())
                run.assert_called_once_with(source, scratch, sha, os.getuid(),
                                            os.getgid(),
                                            unit, usage_root=root)
                with self.assertRaisesRegex(supervisor.BuilderSupervisorRejected,
                                            "noncanonical systemd command"):
                    runner(("/bin/false",), scratch, unit)

    def test_cgroup_v2_preflight_rejects_before_any_builder_launch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, scratch = root / "source", root / "scratch"
            source.mkdir()
            scratch.mkdir()
            unit = f"baci-worker-deps-{'a' * 12}-{'b' * 32}.service"
            journal = Mock()
            journal.read.return_value = {
                "phase": "prepared", "unit": unit, "sha": "a" * 40,
                "uid": os.getuid() + 1, "gid": os.getgid() + 1,
                "source_path": str(source), "source_dev": source.stat().st_dev,
                "source_ino": source.stat().st_ino, "scratch_path": str(scratch),
                "scratch_dev": scratch.stat().st_dev, "scratch_ino": scratch.stat().st_ino,
            }
            with patch.object(supervisor.os, "geteuid", return_value=0), patch.object(
                supervisor.sys, "platform", "linux"), patch.object(
                supervisor, "preflight_cgroup_root",
                              side_effect=CgroupProofRejected("not cgroup v2")), patch.object(
                supervisor, "_spawn_unit") as spawn:
                with self.assertRaisesRegex(supervisor.BuilderSupervisorRejected,
                                            "cgroup v2 system.slice is unavailable"):
                    supervisor.supervise_builder_unit(
                        source, scratch, "a" * 40, os.getuid() + 1, os.getgid() + 1,
                        unit, usage_root=root, unit_journal=journal,
                    )
            spawn.assert_not_called()


class QuarantineTests(unittest.TestCase):
    def test_unexpected_postspawn_proof_error_is_quarantined(self):
        with patch.object(supervisor, "_drain_until_proven",
                          side_effect=CgroupProofRejected("descriptor changed")):
            with self.assertRaises(supervisor.BuilderQuiescenceUnproven):
                supervisor._postspawn_drain(
                    "baci-worker-deps-" + "a" * 12 + "-" + "b" * 32 + ".service",
                    Mock(), 10, os.stat_result((0,) * 10), deadline=1,
                )

    def test_unproven_cgroup_drain_has_distinct_fail_closed_error(self):
        with tempfile.TemporaryFile() as temporary:
            identity = os.fstat(temporary.fileno())
            with self.assertRaises(supervisor.BuilderQuiescenceUnproven):
                drain_until_proven(
                    "baci-worker-deps-" + "a" * 12 + "-" + "b" * 32 + ".service",
                    temporary.fileno(), identity, None, systemctl="/bin/false",
                    query=lambda *_: "active", rejected=supervisor.BuilderSupervisorRejected,
                    deadline=0, unproven=supervisor.BuilderQuiescenceUnproven,
                )

    def test_unproven_attempt_preserves_every_tree_but_releases_build_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            trees = [root / name for name in ("scratch", "input", "result")]
            for path in trees:
                path.mkdir()
                (path / "owner-data").write_text("keep")
            lock_fd = os.open(root / "lock", os.O_CREAT | os.O_RDWR, 0o600)
            dependency_builder._finish_build_attempt(
                *trees, success=False, preserve_for_recovery=True, lock_fd=lock_fd,
            )
            self.assertTrue(all((path / "owner-data").exists() for path in trees))
            with self.assertRaises(OSError):
                os.fstat(lock_fd)

    def test_proven_failure_cleans_scratch_input_and_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            trees = [root / name for name in ("scratch", "input", "result")]
            for path in trees:
                path.mkdir()
            lock_fd = os.open(root / "lock", os.O_CREAT | os.O_RDWR, 0o600)
            dependency_builder._finish_build_attempt(
                *trees, success=False, preserve_for_recovery=False, lock_fd=lock_fd,
            )
            self.assertTrue(all(not path.exists() for path in trees))


if __name__ == "__main__":
    unittest.main()
