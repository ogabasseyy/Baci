#!/usr/bin/env python3
"""Root-only recovery checks for the seed unit and external scratch journal."""
from __future__ import annotations

import json
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
                source=self.source, egress_socket=(1, 2),
                scratch_name=f"seed-{TXID}", builder_uid=self.uid, builder_gid=self.gid,
            )
            create_seed_scratch(self.workspace, TXID, journal, self.uid, self.gid)
            journal.mark_egress_binding_ready((1, 2))
            journal.mark_running()

    def test_exact_fence_drains_unit_and_removes_external_scratch(self):
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False):
            self.assertTrue(recovery.recover_seed_generation(
                self.resource, transaction_id=TXID, expected_fence=FENCE,
                expected_source=self.source,
                expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
            ))
        drain.assert_called_once()
        self.assertEqual(list(self.workspace.iterdir()), [])
        self.assertEqual(list(self.resource.iterdir()), [])

    def test_prelaunch_fixed_socket_binding_recovers_after_crash(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.workspace) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{'b' * 32}.service",
                source=self.source, egress_socket=(1, 2),
                scratch_name=f"seed-{TXID}", builder_uid=self.uid, builder_gid=self.gid,
            )
            create_seed_scratch(self.workspace, TXID, journal, self.uid, self.gid)
            journal.mark_egress_binding_ready((1, 2))
            # A crash before launch leaves only journaled scratch; no alias exists.

        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain, \
             patch.object(recovery, "recover_seed_publication", return_value=False):
            self.assertTrue(recovery.recover_seed_generation(
                self.resource, transaction_id=TXID, expected_fence=FENCE,
                expected_source=self.source,
                expected_source_identity=(self.source.stat().st_dev, self.source.stat().st_ino),
            ))
        drain.assert_called_once()
        self.assertEqual(list(self.workspace.iterdir()), [])
        self.assertEqual(list(self.resource.iterdir()), [])

    def test_legacy_alias_blocks_recovery_without_drain_or_cleanup(self):
        alias = self.workspace / f"baci-seed-egress-{TXID}.sock"
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            listener.bind(str(alias))
            alias.chmod(0o600)
            alias_identity = (alias.lstat().st_dev, alias.lstat().st_ino)
            with patch.object(recovery, "WORK_ROOT", self.workspace), \
                 patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
                 patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
                 patch.object(recovery, "drain_unit") as drain:
                with self.assertRaisesRegex(SeedGenerationRejected,
                                            "legacy seed egress alias blocks recovery"):
                    recovery.recover_seed_generation(
                        self.resource, transaction_id=TXID, expected_fence=FENCE,
                        expected_source=self.source,
                        expected_source_identity=(self.source.stat().st_dev,
                                                  self.source.stat().st_ino),
                    )
            drain.assert_not_called()
            self.assertTrue(alias.exists())
            self.assertEqual((alias.lstat().st_dev, alias.lstat().st_ino), alias_identity)
            self.assertTrue((self.workspace / f"seed-{TXID}").exists())
            self.assertTrue((self.resource / "seed-generation-unit.json").exists())
        finally:
            listener.close()

    def test_legacy_alias_without_journal_blocks_interrupted_begin_recovery(self):
        (self.resource / "seed-generation-unit.json").unlink()
        alias = self.workspace / f"baci-seed-egress-{TXID}.sock"
        alias.write_text("preserve unowned legacy state\n")
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain:
            with self.assertRaisesRegex(SeedGenerationRejected,
                                        "legacy seed egress alias blocks recovery"):
                recovery.recover_seed_generation(
                    self.resource, transaction_id=TXID, expected_fence=FENCE,
                    expected_source=self.source,
                    expected_source_identity=(self.source.stat().st_dev,
                                              self.source.stat().st_ino),
                )
        drain.assert_not_called()
        self.assertTrue(alias.exists())
        self.assertEqual(list(self.resource.iterdir()), [])
        self.assertTrue((self.workspace / f"seed-{TXID}").exists())

    def test_invalid_fixed_socket_identity_preserves_journal_and_scratch(self):
        record_path = self.resource / "seed-generation-unit.json"
        record = json.loads(record_path.read_text(encoding="ascii"))
        record["egress_socket_ino"] = True
        record_path.write_text(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n",
                               encoding="ascii")
        record_path.chmod(0o600)
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain:
            with self.assertRaisesRegex(SeedGenerationRejected, "journal fields are invalid"):
                recovery.recover_seed_generation(
                    self.resource, transaction_id=TXID, expected_fence=FENCE,
                    expected_source=self.source,
                    expected_source_identity=(self.source.stat().st_dev,
                                              self.source.stat().st_ino),
                )
        drain.assert_not_called()
        self.assertTrue(record_path.exists())
        self.assertTrue((self.workspace / f"seed-{TXID}").exists())

    def test_legacy_schema_one_alias_journal_requires_preflight_and_is_preserved(self):
        record_path = self.resource / "seed-generation-unit.json"
        record = json.loads(record_path.read_text(encoding="ascii"))
        record.pop("egress_socket_dev")
        record.pop("egress_socket_ino")
        record.update({
            "schema": 1,
            "alias_name": f"baci-seed-egress-{TXID}.sock",
            "alias_state": "planned",
            "alias_source_dev": None,
            "alias_source_ino": None,
            "placeholder_dev": None,
            "placeholder_ino": None,
        })
        record_path.write_text(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n",
                               encoding="ascii")
        record_path.chmod(0o600)
        original = record_path.read_bytes()
        with patch.object(recovery, "WORK_ROOT", self.workspace), \
             patch.object(recovery, "runtime_identity", return_value=(self.uid, self.gid)), \
             patch.object(recovery, "preflight_cgroup_root", return_value=(1, 2, 3, 4)), \
             patch.object(recovery, "drain_unit") as drain:
            with self.assertRaisesRegex(SeedGenerationRejected,
                                        "requires explicit recovery preflight"):
                recovery.recover_seed_generation(
                    self.resource, transaction_id=TXID, expected_fence=FENCE,
                    expected_source=self.source,
                    expected_source_identity=(self.source.stat().st_dev,
                                              self.source.stat().st_ino),
                )
        drain.assert_not_called()
        self.assertEqual(record_path.read_bytes(), original)
        self.assertTrue((self.workspace / f"seed-{TXID}").exists())

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
                    source=self.source, egress_socket=(1, 2),
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
