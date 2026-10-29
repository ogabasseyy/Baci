"""Disposable root/systemd tests for the dependency-builder cgroup supervisor."""
from __future__ import annotations

import os
import pwd
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_dependency_supervisor as supervisor
import worker_release_dependency_builder as dependency_builder
import worker_release_dependency_sandbox as sandbox
import worker_release_dependency_supervisor_contract as unit_contract
from worker_release_dependency_supervisor_cgroup import drain_until_proven, postspawn_drain
from worker_release_descriptor_cgroup import (
    CgroupProofRejected, require_process_member,
)
from worker_release_dependency_supervisor_cgroup import open_unit_cgroup
from worker_release_dependency_supervisor_journal import (
    BuilderJournalRejected, BuilderUnitJournal, recover_recorded_builder,
)

FENCE = {"repository": "org/repo", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": "a" * 40, "run_id": "1", "run_attempt": 1, "job_id": "2"}

class BuilderSupervisorContractTests(unittest.TestCase):
    def test_systemd_address_family_rendering_is_order_independent_but_exact(self):
        # systemd renders this set in its own canonical order; order is not policy.
        self.assertTrue(unit_contract._address_families_match("AF_INET AF_INET6 AF_UNIX"))
        self.assertFalse(unit_contract._address_families_match("AF_INET AF_UNIX"))
        self.assertFalse(unit_contract._address_families_match(
            "AF_INET AF_INET6 AF_UNIX AF_NETLINK"))
        self.assertFalse(unit_contract._address_families_match(
            "AF_INET AF_INET6 AF_UNIX AF_UNIX"))

    def test_canonical_builder_unit_enables_control_group_protection(self):
        command = sandbox.systemd_command(
            Path("/run/input/source"), Path("/run/build/scratch"), "a" * 40,
            os.getuid(), os.getgid(), "baci-worker-deps-" + "a" * 12 + "-" + "b" * 32 + ".service",
        )
        required = (
            "ProtectControlGroups=true", "ProtectKernelTunables=true",
            "ProtectKernelModules=true", "ProtectKernelLogs=true",
            "ProtectProc=invisible", "ProcSubset=pid", "RestrictRealtime=true",
        )
        for property_value in required:
            with self.subTest(property_value=property_value):
                self.assertIn(property_value, command)

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
                                                      os.getuid(), os.getgid(),
                                                      input_root=None, result_dir=None)
                run.assert_called_once_with(source, scratch, sha, os.getuid(),
                                            os.getgid(), unit, usage_root=root,
                                            unit_journal=journal)
                with self.assertRaisesRegex(supervisor.BuilderSupervisorRejected,
                                            "noncanonical systemd command"):
                    runner(("/bin/false", *expected[1:]), scratch, unit)

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
                postspawn_drain(
                    "baci-worker-deps-" + "a" * 12 + "-" + "b" * 32 + ".service",
                    Mock(), 10, os.stat_result((0,) * 10), deadline=1,
                    drain_pinned=supervisor._drain_until_proven,
                    drain_unpinned=supervisor._drain_unpinned_until_proven,
                    journal=None, unproven=supervisor.BuilderQuiescenceUnproven,
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
