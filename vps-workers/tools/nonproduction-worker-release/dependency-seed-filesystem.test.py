from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))
sys.path.insert(0, str(Path(__file__).parent))
from worker_release_dependency_policy_cache import _hash_tree
import dependency_seed_tree as seed_tree
import dependency_seed_empty_recovery as empty_recovery
import dependency_seed_transaction as seed_transaction


def _write_terminal_gap_journal(root_fd, stage_name):
    fd = seed_transaction.create_inflight_journal(root_fd, "a" * 40, stage_name)
    try:
        value = json.loads(os.read(fd, 2048))
        value["pid"] = os.getpid() + 100_000_000
        value["startTicks"] = 1
        encoded = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        os.ftruncate(fd, 0)
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, encoded)
        os.fsync(fd)
    finally:
        os.close(fd)

MODULE = Path(__file__).with_name("dependency_seed_publisher.py")
SPEC = importlib.util.spec_from_file_location("dependency_seed_publisher", MODULE)
assert SPEC and SPEC.loader
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


class SeedFilesystemPrimitiveTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                         "UID-boundary check requires Linux root")
    def test_private_seed_parent_excludes_worker_uid_during_recovery(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "worker-write"

            def drop_to_worker():
                os.setgroups([])
                os.setgid(65534)
                os.setuid(65534)

            result = subprocess.run(
                (sys.executable, "-c",
                 "import os,sys; os.mkdir(sys.argv[1])", str(target)),
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL, preexec_fn=drop_to_worker,
                timeout=10, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(target.exists())

    def test_empty_unrecorded_stage_replacement_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            name = "." + "a" * 40 + "." + "b" * 32
            stage = root / name
            stage.mkdir(mode=0o700)
            root_fd, lock_fd = publisher._seed_lock(root)
            _write_terminal_gap_journal(root_fd, name)
            original_open = empty_recovery.child_directory

            def replace_before_open(parent_fd, component, *, owner_uid):
                os.rename(component, "preserved-original", src_dir_fd=parent_fd,
                          dst_dir_fd=parent_fd)
                os.mkdir(component, 0o700, dir_fd=parent_fd)
                return original_open(parent_fd, component, owner_uid=owner_uid)

            try:
                with patch.object(empty_recovery, "child_directory", side_effect=replace_before_open):
                    with self.assertRaisesRegex(publisher.BuilderRejected, "inode is unsafe"):
                        empty_recovery.remove_empty_unrecorded_stage(root_fd, lock_fd, name)
            finally:
                os.close(root_fd)
                os.close(lock_fd)
            preserved = root / "preserved-original"
            self.assertTrue(preserved.is_dir())
            self.assertTrue(stage.is_dir())
            self.assertNotEqual(stage.stat().st_ino, preserved.stat().st_ino)

    def test_open_directory_rejects_symlink_in_ancestor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.mkdir()
            alias = root / "alias"
            alias.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(publisher.BuilderRejected, "without following links"):
                publisher.open_directory(alias / "child", owner_uid=os.geteuid(), create=True)
            self.assertFalse((target / "child").exists())

    def test_open_directory_rejects_parent_traversal(self):
        with self.assertRaisesRegex(publisher.BuilderRejected, "parent traversal"):
            publisher.open_directory(Path("/tmp/../tmp"), owner_uid=os.geteuid())

    def test_descriptor_cache_digest_matches_receipt_digest_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "cache"
            (root / "a-dir").mkdir(parents=True)
            (root / "z-dir").mkdir()
            (root / "a-file").write_bytes(b"a")
            (root / "a-dir/child").write_bytes(b"b")
            (root / "z-dir/child").write_bytes(b"c")
            fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                descriptor_hash = publisher.policy_cache_digest_fd(fd, max_bytes=4096)
            finally:
                os.close(fd)
            self.assertEqual(descriptor_hash, _hash_tree(root, max_bytes=4096))

    def test_cache_digest_is_stable_across_directory_enumeration_and_copy_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "first"
            second = root / "second"
            for cache, directory_order in ((first, ("z-dir", "a-dir")),
                                           (second, ("a-dir", "z-dir"))):
                cache.mkdir(mode=0o700)
                for name in directory_order:
                    child = cache / name
                    child.mkdir()
                    (child / "metadata.json").write_bytes(name.encode("ascii"))

            first_fd = os.open(first, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            second_fd = os.open(second, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            root_identities = {
                (os.fstat(first_fd).st_dev, os.fstat(first_fd).st_ino): ["z-dir", "a-dir"],
                (os.fstat(second_fd).st_dev, os.fstat(second_fd).st_ino): ["a-dir", "z-dir"],
            }
            real_listdir = os.listdir

            def fixture_listdir(fd):
                identity = (os.fstat(fd).st_dev, os.fstat(fd).st_ino)
                if identity in root_identities:
                    return root_identities[identity]
                return real_listdir(fd)

            copied_fd = -1
            destination_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                with patch.object(seed_tree.os, "listdir", side_effect=fixture_listdir):
                    first_digest = seed_tree.policy_cache_digest_fd(first_fd, max_bytes=4096)
                    second_digest = seed_tree.policy_cache_digest_fd(second_fd, max_bytes=4096)
                    copied_fd = publisher.copy_tree(first_fd, destination_fd, "copied",
                                                    max_bytes=4096, max_entries=100)
                    copied_digest = seed_tree.policy_cache_digest_fd(copied_fd, max_bytes=4096)
                self.assertEqual(first_digest, second_digest)
                self.assertEqual(first_digest, copied_digest)
                self.assertEqual(first_digest, _hash_tree(first, max_bytes=4096))
            finally:
                if copied_fd >= 0:
                    os.close(copied_fd)
                for fd in (destination_fd, second_fd, first_fd):
                    os.close(fd)

    def test_no_replace_rename_preserves_racing_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "stage").mkdir()
            (root / "target").mkdir()
            (root / "target/marker").write_text("preserve", encoding="ascii")
            parent_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                with self.assertRaisesRegex(publisher.BuilderRejected, "already exists"):
                    publisher.rename_noreplace(parent_fd, "stage", "target")
            finally:
                os.close(parent_fd)
            self.assertEqual((root / "target/marker").read_text(encoding="ascii"), "preserve")

    def test_no_replace_rename_rejects_path_components(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            parent_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                with self.assertRaisesRegex(publisher.BuilderRejected, "name is malformed"):
                    publisher.rename_noreplace(parent_fd, "../outside", "target")
            finally:
                os.close(parent_fd)

    def test_recursive_freeze_check_rejects_writable_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "seed"
            (root / "nested").mkdir(parents=True)
            child = root / "nested/file"
            child.write_text("data", encoding="ascii")
            child.chmod(0o644)
            root_fd = os.open(root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                with self.assertRaisesRegex(publisher.BuilderRejected, "writable or foreign-owned"):
                    publisher.assert_frozen_tree(root_fd, owner_uid=os.geteuid())
            finally:
                os.close(root_fd)

    def test_descriptor_path_matches_procfs_availability(self):
        root_fd = os.open(tempfile.gettempdir(), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            if os.path.isdir("/proc/self/fd"):
                self.assertTrue(publisher.anchored_path(root_fd).is_dir())
            else:
                with self.assertRaisesRegex(publisher.BuilderRejected, "require Linux procfs"):
                    publisher.anchored_path(root_fd)
        finally:
            os.close(root_fd)


if __name__ == "__main__":
    unittest.main()
