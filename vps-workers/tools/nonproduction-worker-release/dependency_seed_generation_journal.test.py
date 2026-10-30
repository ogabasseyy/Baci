#!/usr/bin/env python3
"""Crash-state and identity checks for stage-owned seed-unit journal records."""
from __future__ import annotations

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
            source=self.source, alias_name=f"baci-seed-egress-{'f' * 32}.sock",
            scratch_name=f"seed-{'f' * 32}",
            builder_uid=max(1, os.getuid()), builder_gid=max(1, os.getgid()),
        )

    def test_records_exact_fence_resource_alias_and_drained_lifecycle(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            record = self.make_record(journal)
            self.assertEqual(record["phase"], "prepared")
            with self.assertRaisesRegex(SeedGenerationRejected, "alias must be journaled"):
                journal.mark_running()
            scratch = self.root / record["scratch_name"]
            scratch.mkdir(mode=0o700)
            cache, store = scratch / "cache", scratch / "store"
            cache.mkdir(mode=0o700)
            store.mkdir(mode=0o700)
            journal.mark_scratch_created((scratch.stat().st_dev, scratch.stat().st_ino))
            journal.mark_outputs_created((cache.stat().st_dev, cache.stat().st_ino),
                                         (store.stat().st_dev, store.stat().st_ino))
            journal.mark_alias_prepared((1, 2, 0, 55, 0o140000, 0o660),
                                        (1, 3, 0, 0, 0o600))
            journal.mark_alias_mounted()
            journal.mark_running()
            journal.mark_drained()
            self.assertEqual(journal.read()["phase"], "drained")
            journal.mark_alias_removing()
            self.assertEqual(journal.read()["alias_state"], "removing")
            journal.mark_alias_removed()
            cache.rmdir()
            store.rmdir()
            journal.mark_outputs_removed()
            scratch.rmdir()
            journal.mark_scratch_removed()
            journal.clear()
            self.assertIsNone(journal.read())

    def test_alias_source_and_placeholder_inodes_are_durable_before_mount_phase(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{TXID}.service",
                source=self.source, alias_name=f"baci-seed-egress-{TXID}.sock",
                scratch_name=f"seed-{TXID}", builder_uid=max(1, os.getuid()),
                builder_gid=max(1, os.getgid()),
            )
            source_identity = (10, 20, 0, 55, 0o140000, 0o660)
            placeholder_identity = (10, 21, 0, 0, 0o600)
            journal.mark_alias_prepared(source_identity, placeholder_identity)
            prepared = journal.read()
            self.assertEqual(prepared["alias_state"], "prepared")
            self.assertEqual((prepared["alias_source_dev"], prepared["alias_source_ino"]),
                             source_identity[:2])
            self.assertEqual((prepared["placeholder_dev"], prepared["placeholder_ino"]),
                             placeholder_identity[:2])
            journal.mark_alias_mounted()
            self.assertEqual(journal.read()["alias_state"], "mounted")

    def test_planned_alias_can_record_remove_intent_without_invented_inode(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            journal.begin(
                transaction_id=TXID, fence={**FENCE, "status": "in_progress"},
                unit=f"baci-worker-seed-{'a' * 12}-{TXID}.service",
                source=self.source, alias_name=f"baci-seed-egress-{TXID}.sock",
                scratch_name=f"seed-{TXID}", builder_uid=max(1, os.getuid()),
                builder_gid=max(1, os.getgid()),
            )
            journal.mark_drained()
            journal.mark_alias_removing()
            removing = journal.read()
            self.assertEqual(removing["alias_state"], "removing")
            self.assertIsNone(removing["alias_source_dev"])
            self.assertIsNone(removing["placeholder_ino"])

    def test_rejects_wrong_unit_fence_and_alias_before_recording(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            with self.assertRaises(SeedGenerationRejected):
                journal.begin(
                    transaction_id="f" * 32, fence={**FENCE, "workflow": "wrong.yml"},
                    unit=f"baci-worker-seed-{'c' * 12}-{'b' * 32}.service",
                    source=self.source, alias_name=f"baci-seed-egress-{'f' * 32}.sock",
                    scratch_name=f"seed-{'f' * 32}",
                    builder_uid=max(1, os.getuid()), builder_gid=max(1, os.getgid()),
                )
            with self.assertRaises(SeedGenerationRejected):
                self.make_record(journal)
                journal.mark_alias_removed()

    def test_alias_cannot_be_marked_removed_without_durable_intent(self):
        with SeedGenerationJournal(self.resource, scratch_root=self.root,
                                   owner_uid=os.getuid()) as journal:
            self.make_record(journal)
            scratch = self.root / f"seed-{'f' * 32}"
            scratch.mkdir(mode=0o700)
            cache, store = scratch / "cache", scratch / "store"
            cache.mkdir(mode=0o700)
            store.mkdir(mode=0o700)
            journal.mark_scratch_created((scratch.stat().st_dev, scratch.stat().st_ino))
            journal.mark_outputs_created((cache.stat().st_dev, cache.stat().st_ino),
                                         (store.stat().st_dev, store.stat().st_ino))
            journal.mark_alias_prepared((1, 2, 0, 55, 0o140000, 0o660),
                                        (1, 3, 0, 0, 0o600))
            journal.mark_alias_mounted()
            journal.mark_running()
            journal.mark_drained()
            with self.assertRaisesRegex(SeedGenerationRejected, "durably intended"):
                journal.mark_alias_removed()

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
            journal.mark_alias_prepared((1, 2, 0, 55, 0o140000, 0o660),
                                        (1, 3, 0, 0, 0o600))
            journal.mark_alias_mounted()
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
