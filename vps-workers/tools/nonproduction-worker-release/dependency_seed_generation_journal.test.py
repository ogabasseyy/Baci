#!/usr/bin/env python3
"""Crash-state and identity checks for stage-owned seed-unit journal records."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_generation_journal import SeedGenerationJournal


FENCE = {
    "repository": "ogabasseyy/Baci",
    "workflow": ".github/workflows/production-release.yml",
    "ref": "refs/heads/main", "sha": "a" * 40,
    "run_id": "123", "run_attempt": 2, "job_id": "456",
    "status": "in_progress",
}
TXID = "f" * 32


class SeedUnitJournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-unit-journal-")
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.source = self.root / "source"
        self.source.mkdir(mode=0o700)
        (self.source / "lock.yaml").write_text("locked\n")
        (self.source / "lock.yaml").chmod(0o440)
        self.source.chmod(0o550)
        self.resource = self.root / "resource"
        self.resource.mkdir(mode=0o700)

    def tearDown(self):
        self.source.chmod(0o700)
        (self.source / "lock.yaml").chmod(0o600)
        self.temp.cleanup()

    def make_record(self, journal):
        return journal.begin(
            transaction_id="f" * 32, fence=FENCE,
            unit=f"baci-worker-seed-{'a' * 12}-{'b' * 32}.service",
            source=self.source, egress_socket=(1, 2),
            scratch_name=f"seed-{'f' * 32}",
            builder_uid=max(1, os.getuid()), builder_gid=max(1, os.getgid()),
        )

    def test_records_fixed_socket_and_drained_lifecycle(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            record = self.make_record(journal)
            self.assertEqual(record["schema"], 2)
            self.assertEqual(record["phase"], "prepared")
            with self.assertRaisesRegex(SeedGenerationRejected, "workspace identities"):
                journal.mark_running()
            scratch = self.root / record["scratch_name"]
            scratch.mkdir(mode=0o700)
            cache, store = scratch / "cache", scratch / "store"
            cache.mkdir(mode=0o700)
            store.mkdir(mode=0o700)
            journal.mark_scratch_created((scratch.stat().st_dev, scratch.stat().st_ino))
            journal.mark_outputs_created((cache.stat().st_dev, cache.stat().st_ino),
                                         (store.stat().st_dev, store.stat().st_ino))
            journal.mark_egress_binding_ready((1, 2))
            journal.mark_running()
            journal.mark_drained()
            self.assertEqual(journal.read()["phase"], "drained")
            cache.rmdir()
            store.rmdir()
            journal.mark_outputs_removed()
            scratch.rmdir()
            journal.mark_scratch_removed()
            journal.clear()
            self.assertIsNone(journal.read())

    def test_fixed_socket_inode_is_durable_before_launch(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{TXID}.service",
                source=self.source, egress_socket=(1, 2),
                scratch_name=f"seed-{TXID}", builder_uid=max(1, os.getuid()),
                builder_gid=max(1, os.getgid()),
            )
            journal.mark_egress_binding_ready((1, 2))
            prepared = journal.read()
            self.assertEqual((prepared["egress_socket_dev"], prepared["egress_socket_ino"]), (1, 2))

    def test_fixed_socket_identity_cannot_change_before_launch(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{TXID}.service",
                source=self.source, egress_socket=(1, 2),
                scratch_name=f"seed-{TXID}", builder_uid=max(1, os.getuid()),
                builder_gid=max(1, os.getgid()),
            )
            with self.assertRaisesRegex(SeedGenerationRejected, "socket changed"):
                journal.mark_egress_binding_ready((9, 9))

    def test_legacy_schema_one_alias_record_is_preserved_for_explicit_preflight(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            record = self.make_record(journal)
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
            record_path = self.resource / "seed-generation-unit.json"
            record_path.write_text(json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n",
                                   encoding="ascii")
            record_path.chmod(0o600)
            original = record_path.read_bytes()
            with self.assertRaisesRegex(SeedGenerationRejected,
                                        "legacy alias seed journal requires explicit recovery preflight"):
                journal.read()
            self.assertEqual(record_path.read_bytes(), original)

    def test_rejects_wrong_unit_fence_and_alias_before_recording(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            with self.assertRaises(SeedGenerationRejected):
                journal.begin(
                    transaction_id="f" * 32, fence={**FENCE, "workflow": "wrong.yml"},
                    unit=f"baci-worker-seed-{'c' * 12}-{'b' * 32}.service",
                    source=self.source, egress_socket=(1, 2),
                    scratch_name=f"seed-{'f' * 32}",
                    builder_uid=max(1, os.getuid()), builder_gid=max(1, os.getgid()),
                )
            self.make_record(journal)

    def test_rejects_journal_copy_under_different_resource_inode(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            self.make_record(journal)
        other = self.root / "other"
        other.mkdir(mode=0o700)
        (other / "seed-generation-unit.json").write_bytes(
            (self.resource / "seed-generation-unit.json").read_bytes())
        (other / "seed-generation-unit.json").chmod(0o600)
        with SeedGenerationJournal(other, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            with self.assertRaisesRegex(SeedGenerationRejected, "fields are invalid"):
                journal.read()

    def test_cleanup_transition_rejects_replaced_scratch_symlink(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            record = self.make_record(journal)
            scratch = self.root / record["scratch_name"]
            scratch.mkdir(mode=0o700)
            cache, store = scratch / "cache", scratch / "store"
            cache.mkdir(mode=0o700)
            store.mkdir(mode=0o700)
            journal.mark_scratch_created((scratch.stat().st_dev, scratch.stat().st_ino))
            journal.mark_outputs_created((cache.stat().st_dev, cache.stat().st_ino),
                                         (store.stat().st_dev, store.stat().st_ino))
            journal.mark_egress_binding_ready((1, 2))
            journal.mark_running()
            journal.mark_drained()
            cache.rmdir()
            store.rmdir()
            scratch.rmdir()
            scratch.symlink_to(self.source, target_is_directory=True)
            with self.assertRaisesRegex(SeedGenerationRejected, "cleanup parent"):
                journal.mark_outputs_removed()
            scratch.unlink()


if __name__ == "__main__":
    unittest.main()
