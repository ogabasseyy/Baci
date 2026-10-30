from __future__ import annotations

import fcntl
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
BIN = TOOLS.parents[1] / "bin"
sys.path.insert(0, str(BIN))
sys.path.insert(0, str(TOOLS))

import dependency_seed_publisher as publisher
import dependency_seed_provision as provision
from dependency_seed_transaction import existing_seed_lock


class DependencySeedProvisionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=TOOLS)
        self.root = Path(self.temporary.name) / "seeds"
        self.parent_fd = os.open(self.temporary.name,
                                 os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.owner_uid = os.geteuid()

    def tearDown(self):
        os.close(self.parent_fd)
        self.temporary.cleanup()

    def provision_fixture(self):
        root_fd = provision._ensure_child_directory(
            self.parent_fd, self.root.name, owner_uid=self.owner_uid,
            create_mode=provision.ROOT_MODE, exact_mode=provision.ROOT_MODE,
        )
        try:
            provision._ensure_lock(root_fd, owner_uid=self.owner_uid)
        finally:
            os.close(root_fd)

    def test_unmounted_workspace_is_rejected_before_seed_path_creation(self):
        with patch.object(provision.os, "geteuid", return_value=0), \
             patch.object(provision, "verify_bounded_seed_workspace",
                          side_effect=provision.SeedProvisionRejected("not mounted")), \
             patch.object(provision, "_open_root_anchor",
                          side_effect=AssertionError("seed path must not be opened")) as open_anchor:
            with self.assertRaisesRegex(provision.SeedProvisionRejected, "not mounted"):
                provision.provision_seed_root()
        open_anchor.assert_not_called()

    def test_creates_exact_publisher_root_and_lock_contract(self):
        self.provision_fixture()
        root_info = self.root.lstat()
        lock_info = (self.root / provision.LOCK_NAME).lstat()
        self.assertTrue(stat.S_ISDIR(root_info.st_mode))
        self.assertEqual(root_info.st_uid, self.owner_uid)
        self.assertEqual(stat.S_IMODE(root_info.st_mode), 0o700)
        self.assertTrue(stat.S_ISREG(lock_info.st_mode))
        self.assertEqual(lock_info.st_uid, self.owner_uid)
        self.assertEqual(lock_info.st_nlink, 1)
        self.assertEqual(stat.S_IMODE(lock_info.st_mode), 0o600)
        self.assertEqual(lock_info.st_size, 0)

    def test_publisher_and_consumer_lock_interfaces_use_provisioned_inode(self):
        self.provision_fixture()
        expected = (self.root / provision.LOCK_NAME).stat()
        root_fd, lock_fd = publisher._seed_lock(self.root)
        try:
            publisher_lock = os.fstat(lock_fd)
            self.assertEqual((publisher_lock.st_dev, publisher_lock.st_ino),
                             (expected.st_dev, expected.st_ino))
        finally:
            os.close(lock_fd)
            os.close(root_fd)
        root_fd, lock_fd = existing_seed_lock(self.root)
        try:
            consumer_lock = os.fstat(lock_fd)
            self.assertEqual((consumer_lock.st_dev, consumer_lock.st_ino),
                             (expected.st_dev, expected.st_ino))
        finally:
            os.close(lock_fd)
            os.close(root_fd)

    def test_repeated_provisioning_is_inode_preserving_and_leaves_seed_entries(self):
        self.provision_fixture()
        published = self.root / ("a" * 40)
        published.mkdir(mode=0o500)
        root_before = self.root.stat()
        lock_before = (self.root / provision.LOCK_NAME).stat()
        self.provision_fixture()
        root_after = self.root.stat()
        lock_after = (self.root / provision.LOCK_NAME).stat()
        self.assertEqual((root_before.st_dev, root_before.st_ino),
                         (root_after.st_dev, root_after.st_ino))
        self.assertEqual((lock_before.st_dev, lock_before.st_ino),
                         (lock_after.st_dev, lock_after.st_ino))
        self.assertTrue(published.is_dir())

    def test_existing_wrong_mode_root_is_refused_without_chmod(self):
        self.root.mkdir(mode=0o755)
        before = self.root.lstat()
        with self.assertRaises(provision.SeedProvisionRejected):
            provision._ensure_child_directory(
                self.parent_fd, self.root.name, owner_uid=self.owner_uid,
                create_mode=provision.ROOT_MODE, exact_mode=provision.ROOT_MODE,
            )
        after = self.root.lstat()
        self.assertEqual(stat.S_IMODE(after.st_mode), stat.S_IMODE(before.st_mode))

    def test_root_symlink_is_refused_and_target_is_preserved(self):
        target = Path(self.temporary.name) / "target"
        target.mkdir(mode=0o700)
        (target / "keep").write_text("preserve", encoding="utf-8")
        self.root.symlink_to(target, target_is_directory=True)
        with self.assertRaises(provision.SeedProvisionRejected):
            provision._ensure_child_directory(
                self.parent_fd, self.root.name, owner_uid=self.owner_uid,
                create_mode=provision.ROOT_MODE, exact_mode=provision.ROOT_MODE,
            )
        self.assertEqual((target / "keep").read_text(encoding="utf-8"), "preserve")

    def test_lock_symlink_is_refused_and_target_is_preserved(self):
        self.root.mkdir(mode=0o700)
        target = Path(self.temporary.name) / "target-lock"
        target.write_text("keep", encoding="utf-8")
        (self.root / provision.LOCK_NAME).symlink_to(target)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            with self.assertRaises(provision.SeedProvisionRejected):
                provision._ensure_lock(root_fd, owner_uid=self.owner_uid)
        finally:
            os.close(root_fd)
        self.assertEqual(target.read_text(encoding="utf-8"), "keep")

    def test_lock_hardlink_is_refused_without_removing_either_name(self):
        self.root.mkdir(mode=0o700)
        lock = self.root / provision.LOCK_NAME
        lock.touch(mode=0o600)
        alias = Path(self.temporary.name) / "lock-alias"
        os.link(lock, alias)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            with self.assertRaises(provision.SeedProvisionRejected):
                provision._ensure_lock(root_fd, owner_uid=self.owner_uid)
        finally:
            os.close(root_fd)
        self.assertTrue(lock.exists())
        self.assertTrue(alias.exists())

    def test_active_publication_lock_is_not_treated_as_provisioned(self):
        self.provision_fixture()
        lock_fd = os.open(self.root / provision.LOCK_NAME, os.O_RDWR | os.O_NOFOLLOW)
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            with self.assertRaisesRegex(provision.SeedProvisionRejected, "already active"):
                provision._ensure_lock(root_fd, owner_uid=self.owner_uid)
        finally:
            os.close(root_fd)
            os.close(lock_fd)

    def test_plan_is_root_path_specific_and_does_not_claim_preverification(self):
        lines = provision.plan()
        self.assertTrue(any(str(provision.SEED_ROOT) in line for line in lines))
        joined = "\n".join(lines).lower()
        self.assertIn("no source authentication", joined)
        self.assertIn("pnpm preverification", joined)
        self.assertIn("preserve all existing per-sha entries", joined)

    def test_lock_with_nonempty_content_is_refused_without_rewriting(self):
        self.root.mkdir(mode=0o700)
        lock = self.root / provision.LOCK_NAME
        lock.write_bytes(b"keep")
        lock.chmod(0o600)
        root_fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            with self.assertRaises(provision.SeedProvisionRejected):
                provision._ensure_lock(root_fd, owner_uid=self.owner_uid)
        finally:
            os.close(root_fd)
        self.assertEqual(lock.read_bytes(), b"keep")


if __name__ == "__main__":
    unittest.main()
