#!/usr/bin/env python3
"""Disposable root tests for provisioner journal wiring (all host tools mocked)."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import worker_release_seed_workspace as policy
import worker_release_seed_workspace_provision as provisioner
from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_journal import JOURNAL_NAME, SeedWorkspaceJournal


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                     "disposable provisioner integration requires Linux root")
class SeedWorkspaceProvisionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-workspace-provision-")
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.cache = self.root / "cache"
        self.cache.mkdir(mode=0o700)
        self.unit_dir = self.root / "units"
        self.unit_dir.mkdir(mode=0o700)
        self.image = self.cache / "baci-worker-release" / "seed-work.img"
        self.workspace = self.cache / "baci-worker-release" / "seed-work"
        self.unit_name = "fixed-seed-work.mount"
        self.calls = []
        self.patches = [
            patch.object(policy, "IMAGE", self.image),
            patch.object(policy, "WORK_ROOT", self.workspace),
            patch.object(policy, "UNIT_DIR", self.unit_dir),
            patch.object(policy, "UNIT_NAME", self.unit_name),
            patch.object(policy, "IMAGE_BYTES", 128),
            patch.object(policy, "INODE_COUNT", 16),
            patch.object(policy, "EXPECTED_OBSERVED_BYTES", 32),
            patch.object(policy, "EXPECTED_OBSERVED_INODES", 4),
            patch.object(policy, "host_capacity", return_value=(10**9, 10**6)),
            patch.object(policy, "_trusted_directory"),
            patch.object(provisioner, "trusted_directory"),
            patch.object(policy, "_secure_mounted_root"),
            patch.object(policy, "_verify_mount"),
            patch("worker_release_seed_workspace_recovery.os.path.ismount", return_value=False),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def runner(self, args, **_kwargs):
        self.calls.append(args)
        if args[0] == "/usr/bin/systemctl" and "--property=ActiveState" in args:
            return SimpleNamespace(stdout="inactive\n", returncode=0)
        if args[0] == "/usr/sbin/losetup":
            return SimpleNamespace(stdout="", returncode=0)
        return SimpleNamespace(stdout="", returncode=0)

    def allocate(self, fd, _offset, length):
        os.ftruncate(fd, length)

    def run_provision(self):
        provisioner.provision_seed_workspace(
            runner=self.runner, fallocate=self.allocate,
        )

    def test_complete_journal_is_verified_and_second_apply_is_idempotent(self):
        with patch.object(policy.sys, "platform", "linux"):
            self.run_provision()
            before = self.image.stat().st_ino
            self.run_provision()
        self.assertEqual(self.image.stat().st_ino, before)
        self.assertTrue((self.workspace / "seeds").is_dir())
        with SeedWorkspaceJournal(self.image.parent, owner_uid=0) as journal:
            record = journal.read()
        self.assertEqual(record["phase"], "complete")

    def test_interrupted_transaction_is_recovered_before_new_generation(self):
        self.workspace.mkdir(mode=0o700, parents=True)
        with SeedWorkspaceJournal(self.image.parent, owner_uid=0) as journal:
            record = journal.begin()
            self.image.touch(mode=0o600)
            identity = self.image.stat().st_dev, self.image.stat().st_ino
            journal.update(record, phase="image_created", image_identity=identity)
            unit = self.unit_dir / self.unit_name
            unit.write_bytes(policy.mount_unit_contents())
            unit.chmod(0o644)
            journal.update(record, phase="unit_installing")
        with patch.object(policy.sys, "platform", "linux"):
            self.run_provision()
        self.assertEqual(self.calls[0], ("/usr/bin/systemctl", "disable", "--now", self.unit_name))
        self.assertTrue(self.image.exists())
        with SeedWorkspaceJournal(self.image.parent, owner_uid=0) as journal:
            record = journal.read()
        self.assertEqual(record["phase"], "complete")

    def test_unrecorded_preexisting_image_is_never_adopted(self):
        self.workspace.mkdir(mode=0o700, parents=True)
        self.image.touch(mode=0o600)
        with patch.object(policy.sys, "platform", "linux"):
            with self.assertRaisesRegex(BuilderRejected, "cannot be adopted"):
                self.run_provision()
        self.assertTrue(self.image.exists())
        self.assertFalse((self.image.parent / JOURNAL_NAME).exists())


if __name__ == "__main__":
    unittest.main()
