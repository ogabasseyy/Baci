from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_journal import SeedWorkspaceJournal, JOURNAL_NAME
from worker_release_seed_workspace_recovery import recover_interrupted_setup


class SeedWorkspaceRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-workspace-recovery-")
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.image = self.root / "seed-work.img"
        self.workspace = self.root / "seed-work"
        self.workspace.mkdir(mode=0o700)
        self.unit_dir = self.root / "units"
        self.unit_dir.mkdir(mode=0o700)
        self.unit_name = "seed-work.mount"
        self.payload = b"[Mount]\nWhat=/fixed/image\nWhere=/fixed/work\n"
        self.owner = os.getuid()
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def runner(self, args, **_kwargs):
        self.calls.append(args)
        if args[0] == "/usr/bin/systemctl" and "--property=ActiveState" in args:
            return SimpleNamespace(stdout="inactive\n", returncode=0)
        if args[0] == "/usr/sbin/losetup":
            return SimpleNamespace(stdout="", returncode=0)
        return SimpleNamespace(stdout="", returncode=0)

    def recover(self, journal):
        return recover_interrupted_setup(
            journal, runner=self.runner, image=self.image, workspace=self.workspace,
            unit_dir=self.unit_dir, unit_name=self.unit_name, unit_payload=self.payload,
            image_bytes=100, verify_complete=lambda _identity: None, owner_uid=self.owner,
        )

    def test_planned_journal_recovers_crash_after_image_create_before_inode_record(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            journal.begin()
            self.image.touch(mode=0o600)
            with patch("worker_release_seed_workspace_recovery.os.path.ismount", return_value=False):
                self.assertEqual(self.recover(journal), "recovered")
            self.assertFalse(self.image.exists())
            self.assertFalse((self.root / JOURNAL_NAME).exists())
            self.assertTrue(any(call[0] == "/usr/sbin/losetup" for call in self.calls))

    def test_interrupted_exact_unit_is_stopped_before_image_and_journal_removal(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = journal.begin()
            fd = os.open(self.image, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, b"formatted-image-fixture")
            os.close(fd)
            identity = self.image.stat().st_dev, self.image.stat().st_ino
            record = journal.update(record, phase="image_created", image_identity=identity)
            unit = self.unit_dir / self.unit_name
            unit.write_bytes(self.payload)
            unit.chmod(0o644)
            journal.update(record, phase="unit_installing")
            with patch("worker_release_seed_workspace_recovery.os.path.ismount", return_value=False):
                self.assertEqual(self.recover(journal), "recovered")
            self.assertFalse(self.image.exists())
            self.assertFalse(unit.exists())
            self.assertLess(self.calls.index(("/usr/bin/systemctl", "disable", "--now", self.unit_name)),
                            self.calls.index(("/usr/sbin/losetup", "--associated", "--noheadings", str(self.image))))

    def test_mount_or_unknown_unit_keeps_durable_record_and_resources(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = journal.begin()
            self.image.touch(mode=0o600)
            identity = self.image.stat().st_dev, self.image.stat().st_ino
            journal.update(record, phase="image_created", image_identity=identity)
            unit = self.unit_dir / self.unit_name
            unit.write_bytes(b"foreign unit")
            unit.chmod(0o644)
            with patch("worker_release_seed_workspace_recovery.os.path.ismount", return_value=True):
                with self.assertRaisesRegex(BuilderRejected, "fixed provisioner contract"):
                    self.recover(journal)
            self.assertTrue(self.image.exists())
            self.assertTrue((self.root / JOURNAL_NAME).exists())
            self.assertFalse(self.calls)

    def test_completed_journal_requires_exact_image_and_verifier_before_adoption(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = journal.begin()
            fd = os.open(self.image, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.write(fd, b"x" * 100)
            os.close(fd)
            identity = self.image.stat().st_dev, self.image.stat().st_ino
            record = journal.update(record, phase="image_created", image_identity=identity)
            unit = self.unit_dir / self.unit_name
            unit.write_bytes(self.payload)
            unit.chmod(0o644)
            journal.update(record, phase="complete", image_identity=identity)
            verified = []
            self.assertEqual(recover_interrupted_setup(
                journal, runner=self.runner, image=self.image, workspace=self.workspace,
                unit_dir=self.unit_dir, unit_name=self.unit_name, unit_payload=self.payload,
                image_bytes=100, verify_complete=lambda value: verified.append(value),
                owner_uid=self.owner,
            ), "complete")
            self.assertEqual(verified, [identity])
            self.assertTrue(self.image.exists())
            self.assertTrue(unit.exists())

    def test_journal_temporary_from_begin_is_safe_to_discard_without_mutations(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = {"schema": 1, "transaction_id": "f" * 32,
                      "phase": "planned", "image_identity": None}
            journal._write(record, create=True)
            # Simulate a crash after the fully fsynced temp exists but before
            # the no-replace hardlink publishes the primary record.
            (self.root / JOURNAL_NAME).unlink()
            temporary = self.root / f".seed-workspace-provision.{'f' * 32}.tmp"
            temporary.write_text('{"schema":1,"transaction_id":"partial', encoding="ascii")
            temporary.chmod(0o600)
            self.assertIsNone(journal.read())
            self.assertFalse(temporary.exists())

    def test_journal_creation_finishes_with_one_link_and_no_alias_temp(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = journal.begin()
            info = (self.root / JOURNAL_NAME).lstat()
            self.assertEqual(info.st_nlink, 1)
            self.assertEqual([path.name for path in self.root.glob(".seed-workspace-provision.*.tmp")], [])
            alias = self.root / f".seed-workspace-provision.{record['transaction_id']}.tmp"
            os.link(self.root / JOURNAL_NAME, alias)
            self.assertEqual((self.root / JOURNAL_NAME).stat().st_nlink, 2)
            self.assertEqual(journal.read(), record)
            self.assertFalse(alias.exists())
            self.assertEqual((self.root / JOURNAL_NAME).stat().st_nlink, 1)

    def test_recovery_removes_only_exact_transaction_unit_temp(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = journal.begin()
            journal.update(record, phase="unit_installing")
            temporary = self.unit_dir / f".{self.unit_name}.{record['transaction_id']}.tmp"
            temporary.write_bytes(self.payload[:15])
            temporary.chmod(0o600)
            with patch("worker_release_seed_workspace_recovery.os.path.ismount", return_value=False):
                self.assertEqual(self.recover(journal), "recovered")
            self.assertFalse(temporary.exists())
            self.assertFalse((self.root / JOURNAL_NAME).exists())

    def test_recovery_removes_only_exact_unit_hardlink_publication_window(self):
        with SeedWorkspaceJournal(self.root, owner_uid=self.owner) as journal:
            record = journal.begin()
            journal.update(record, phase="unit_installing")
            temporary = self.unit_dir / f".{self.unit_name}.{record['transaction_id']}.tmp"
            temporary.write_bytes(self.payload)
            temporary.chmod(0o644)
            unit = self.unit_dir / self.unit_name
            os.link(temporary, unit)
            self.assertEqual(temporary.stat().st_nlink, 2)
            with patch("worker_release_seed_workspace_recovery.os.path.ismount", return_value=False):
                self.assertEqual(self.recover(journal), "recovered")
            self.assertFalse(temporary.exists())
            self.assertFalse(unit.exists())
            self.assertFalse((self.root / JOURNAL_NAME).exists())


if __name__ == "__main__":
    unittest.main()
