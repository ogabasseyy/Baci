#!/usr/bin/env python3
"""Root-only recovery checks for the seed unit and external scratch journal."""
from __future__ import annotations

import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

BIN = Path(__file__).resolve().parents[2] / "bin"
sys.path.insert(0, str(BIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dependency_seed_generation_recovery as recovery
import dependency_seed_generation_unit as generation_unit
from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_generation_journal import SeedGenerationJournal
from dependency_seed_generation_workspace import create_seed_scratch

FENCE = {
    "repository": "ogabasseyy/Baci", "workflow": ".github/workflows/production-release.yml",
    "ref": "refs/heads/main", "sha": "a" * 40, "run_id": "123",
    "run_attempt": 2, "job_id": "456",
}
TXID = "f" * 32


@unittest.skipUnless(os.geteuid() == 0, "requires root-owned recovery fixtures")
class SeedGenerationRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-recovery-")
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.resource = self.root / "resource"
        self.resource.mkdir(mode=0o700)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir(mode=0o700)
        self.source = self.root / "source"
        self.source.mkdir(mode=0o550)
        (self.source / "lock.yaml").write_text("locked\n")
        (self.source / "lock.yaml").chmod(0o440)
        self.uid, self.gid = 65534, 65534
        self._write_running_journal()
        self.mount_proof = patch.object(recovery, "verify_bounded_seed_workspace")
        self.mount_proof.start()

    def tearDown(self):
        self.mount_proof.stop()
        self.source.chmod(0o700)
        (self.source / "lock.yaml").chmod(0o600)
        self.temp.cleanup()

    def _write_running_journal(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.workspace) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{'b' * 32}.service",
                source=self.source, alias_name=f"baci-seed-egress-{TXID}.sock",
                scratch_name=f"seed-{TXID}", builder_uid=self.uid, builder_gid=self.gid,
            )
            create_seed_scratch(self.workspace, TXID, journal, self.uid, self.gid)
            journal.mark_alias_prepared((1, 2, 0, self.gid, 0o140000, 0o660),
                                        (1, 3, 0, 0, 0o600))
            journal.mark_alias_mounted()
            journal.mark_running()

    def test_exact_fence_drains_alias_and_removes_external_scratch(self):
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False), \
             patch.object(recovery, "recover_egress_source_alias") as alias:
            self.assertTrue(recovery.recover_seed_generation(
                self.resource, transaction_id=TXID, expected_fence=FENCE,
                expected_source=self.source,
                expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
            ))
        drain.assert_called_once()
        alias.assert_called_once()
        self.assertTrue(alias.call_args.kwargs["allow_absent"])
        self.assertEqual(alias.call_args.kwargs["expected_source_identity"], (1, 2))
        self.assertEqual(alias.call_args.kwargs["expected_placeholder_identity"], (1, 3))
        self.assertEqual(list(self.workspace.iterdir()), [])
        self.assertEqual(list(self.resource.iterdir()), [])

    def test_prepared_alias_recovers_mount_crash_before_mounted_phase_write(self):
        source_identity = (1, 2, 0, self.gid, 0o140000, 0o660)
        placeholder_identity = (1, 3, 0, 0, 0o600)
        with SeedGenerationJournal(self.resource, scratch_root=self.workspace) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{'b' * 32}.service",
                source=self.source, alias_name=f"baci-seed-egress-{TXID}.sock",
                scratch_name=f"seed-{TXID}", builder_uid=self.uid, builder_gid=self.gid,
            )
            create_seed_scratch(self.workspace, TXID, journal, self.uid, self.gid)
            journal.mark_alias_prepared(source_identity, placeholder_identity)
            # Crash after mount, before mark_alias_mounted: durable phase still prepared.

        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False), \
             patch.object(recovery, "recover_egress_source_alias") as alias:
            self.assertTrue(recovery.recover_seed_generation(
                self.resource, transaction_id=TXID, expected_fence=FENCE,
                expected_source=self.source,
                expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
            ))
        drain.assert_called_once()
        self.assertEqual(alias.call_args.kwargs["expected_source_identity"], (1, 2))
        self.assertEqual(alias.call_args.kwargs["expected_placeholder_identity"], (1, 3))
        self.assertEqual(list(self.workspace.iterdir()), [])
        self.assertEqual(list(self.resource.iterdir()), [])

    def test_integrated_recovery_cleans_prejournal_placeholder_from_planned_record(self):
        transaction_id = "a" * 32
        resource = self.root / "planned-resource"
        resource.mkdir(mode=0o700)
        alias_path = self.workspace / f"baci-seed-egress-{transaction_id}.sock"
        broker_socket = self.root / "egress-broker.sock"
        broker_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        alias_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            broker_listener.bind(str(broker_socket))
            broker_socket.chmod(0o660)
            os.chown(broker_socket, 0, 0)
            old_umask = os.umask(0o177)
            try:
                alias_listener.bind(str(alias_path))
            finally:
                os.umask(old_umask)
                alias_listener.close()
            alias_info = alias_path.lstat()
            self.assertEqual((alias_info.st_uid, alias_info.st_gid,
                              alias_info.st_mode & 0o777), (0, 0, 0o600))

            with SeedGenerationJournal(resource, scratch_root=self.workspace) as journal:
                journal.begin(
                    transaction_id=transaction_id,
                    fence={**FENCE, "status": "in_progress"},
                    unit=f"baci-worker-seed-{'a' * 12}-{transaction_id}.service",
                    source=self.source,
                    alias_name=f"baci-seed-egress-{transaction_id}.sock",
                    scratch_name=f"seed-{transaction_id}",
                    builder_uid=self.uid, builder_gid=self.gid,
                )
                create_seed_scratch(self.workspace, transaction_id, journal,
                                    self.uid, self.gid)

            with patch.object(recovery, "WORK_ROOT", self.workspace), \
                 patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
                 patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
                 patch.object(recovery, "drain_unit") as drain, \
                 patch.object(recovery, "recover_seed_publication", return_value=False), \
                 patch.object(generation_unit, "EGRESS_SOURCE_ROOT", self.workspace), \
                 patch.object(generation_unit, "EGRESS_SOCKET", broker_socket), \
                 patch.object(generation_unit, "identity", return_value=(1234, self.gid)), \
                 patch.object(generation_unit, "trusted_directory_chain"), \
                 patch.object(generation_unit, "trusted_socket"), \
                 patch.object(generation_unit, "_is_mountpoint", return_value=False):
                self.assertTrue(recovery.recover_seed_generation(
                    resource, transaction_id=transaction_id,
                    expected_fence=FENCE, expected_source=self.source,
                    expected_source_identity=(self.source.stat().st_dev,
                                              self.source.stat().st_ino),
                ))
            drain.assert_called_once()
            self.assertFalse(alias_path.exists())
            self.assertEqual(list(self.workspace.iterdir()), [])
            self.assertEqual(list(resource.iterdir()), [])
        finally:
            broker_listener.close()

    def test_mismatched_stage_fence_preserves_all_resources(self):
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False):
            with self.assertRaisesRegex(SeedGenerationRejected, "differs from its stage transaction"):
                recovery.recover_seed_generation(
                    self.resource, transaction_id=TXID, expected_fence={**FENCE, "sha": "c" * 40},
                    expected_source=self.source,
                    expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
                )
        drain.assert_not_called()
        self.assertEqual(len(list(self.workspace.iterdir())), 1)

    def test_removing_alias_is_recovered_after_unit_drain_when_name_is_absent(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.workspace) as journal:
            journal.mark_drained()
            journal.mark_alias_removing()
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False), \
             patch.object(recovery, "recover_egress_source_alias") as alias:
            self.assertTrue(recovery.recover_seed_generation(
                self.resource, transaction_id=TXID, expected_fence=FENCE,
                expected_source=self.source,
                expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
            ))
        drain.assert_called_once()
        alias.assert_called_once()
        self.assertTrue(alias.call_args.kwargs["allow_absent"])
        self.assertFalse((self.workspace / f"baci-seed-egress-{TXID}.sock").exists())

    def test_alias_cleanup_is_not_attempted_when_unit_drain_fails(self):
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit", side_effect=SeedGenerationRejected("active")) as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False), \
             patch.object(recovery, "recover_egress_source_alias") as alias:
            with self.assertRaisesRegex(SeedGenerationRejected, "active"):
                recovery.recover_seed_generation(
                    self.resource, transaction_id=TXID, expected_fence=FENCE,
                    expected_source=self.source,
                    expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
                )
        drain.assert_called_once()
        alias.assert_not_called()

    def test_recovery_requires_bounded_mount_before_runtime_or_source_access(self):
        source = Mock()
        with patch.object(recovery, "verify_bounded_seed_workspace",
                          side_effect=RuntimeError("unmounted")), \
             patch.object(recovery, "runtime_identity") as runtime, \
             patch.object(recovery, "preflight_cgroup_root") as cgroup:
            with self.assertRaisesRegex(SeedGenerationRejected, "bounded workspace mount"):
                recovery.recover_seed_generation(
                    self.resource, transaction_id=TXID, expected_fence=FENCE,
                    expected_source=source,
                    expected_source_identity=(1, 2),
                )
        runtime.assert_not_called()
        cgroup.assert_not_called()
        source.lstat.assert_not_called()
        self.assertTrue((self.workspace / f"seed-{TXID}").exists())

    def test_unlinked_atomic_journal_temp_is_recovered_without_nlink_two_window(self):
        from dependency_seed_generation_journal import NAME
        resource = self.root / "atomic-resource"
        workspace = self.root / "atomic-workspace"
        resource.mkdir(mode=0o700)
        workspace.mkdir(mode=0o700)
        temporary = resource / f".{NAME}.{TXID}.tmp"
        with SeedGenerationJournal(resource, scratch_root=workspace) as journal:
            with patch("dependency_seed_generation_journal.rename_noreplace",
                       wraps=__import__("dependency_seed_publication").rename_noreplace) as publish:
                journal.begin(
                    transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                    unit=f"baci-worker-seed-{'a' * 12}-{'b' * 32}.service",
                    source=self.source, alias_name=f"baci-seed-egress-{TXID}.sock",
                    scratch_name=f"seed-{TXID}", builder_uid=self.uid,
                    builder_gid=self.gid,
                )
            publish.assert_called_once()
        canonical = resource / NAME
        self.assertEqual(canonical.stat().st_nlink, 1)
        canonical.unlink()
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.write(fd, b"interrupted before rename\n")
        os.fsync(fd)
        os.close(fd)
        self.assertEqual(temporary.stat().st_nlink, 1)
        with patch.object(recovery, "WORK_ROOT", workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)):
            self.assertFalse(recovery.recover_seed_generation(
                resource, transaction_id=TXID, expected_fence=FENCE,
                expected_source=self.source,
                expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
            ))
        self.assertFalse(temporary.exists())


if __name__ == "__main__":
    unittest.main()
