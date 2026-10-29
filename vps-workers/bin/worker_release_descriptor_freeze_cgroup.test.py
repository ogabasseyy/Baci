import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_descriptor_freeze import FreezeRejected, freeze_staged_tree
import worker_release_descriptor_freeze as freeze_module
from worker_release_descriptor_cgroup import CgroupProofRejected, require_empty_cgroup
from worker_release_descriptor_cgroup_test_support import (
    _dedicated_child, _kill_cgroup_and_wait_empty, _move_to_test_cgroup, _open_test_cgroup,
)


class DescriptorFreezeCgroupIntegrationTests(unittest.TestCase):
    def test_stage_tree_stays_private_under_traversable_temp_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            os.chmod(temporary, 0o711)
            root = Path(temporary) / "incoming"
            root.mkdir(mode=0o700)
            self.assertEqual(stat.S_IMODE(os.stat(temporary).st_mode), 0o711)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)

    def test_dedicated_child_protocol_reaches_ready_before_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "marker"
            process = _dedicated_child(os.geteuid(), os.getegid(), marker, sleep_seconds=0.01)
            try:
                assert process.stdin is not None
                process.stdin.write(b"go\n")
                process.stdin.flush()
                process.stdin.close()
                assert process.stdout is not None
                self.assertEqual(process.stdout.readline(), b"READY\n")
                process.stdout.close()
                self.assertEqual(process.wait(timeout=2), 0)
                self.assertEqual(marker.read_text(), "archive entry")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()

    @unittest.skipUnless(os.geteuid() == 0 and os.environ.get("WORKER_RELEASE_TEST_CGROUP_PATH"),
                         "requires root and a disposable dedicated cgroup v2 fixture")
    def test_freezes_tree_after_reaped_dedicated_uid_archive_writer(self):
        import pwd

        stage = pwd.getpwnam("nobody").pw_uid
        stage_gid = pwd.getpwnam("nobody").pw_gid
        worker = pwd.getpwnam("daemon").pw_uid
        worker_gid = pwd.getpwnam("daemon").pw_gid
        with tempfile.TemporaryDirectory() as temporary:
            os.chmod(temporary, 0o711)
            root = Path(temporary) / "incoming"
            root.mkdir(mode=0o700)
            (root / "bin").mkdir(mode=0o700)
            (root / "bin" / "run.sh").write_text("#!/bin/sh\nexit 0\n")
            os.chmod(root / "bin" / "run.sh", 0o700)
            for path in (root / "bin" / "run.sh", root / "bin", root):
                os.chown(path, stage, stage_gid)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(fd)
            cgroup_fd, cgroup_info = _open_test_cgroup(self)
            extracted = root / "extracted-marker"
            process = _dedicated_child(stage, stage_gid, extracted)
            try:
                _move_to_test_cgroup(self, cgroup_fd, process)
                stats = freeze_staged_tree(
                    fd, process, expected_dev=info.st_dev, expected_ino=info.st_ino,
                    extractor_uid=stage, extractor_gid=stage_gid,
                    cgroup_fd=cgroup_fd, expected_cgroup_dev=cgroup_info.st_dev,
                    expected_cgroup_ino=cgroup_info.st_ino,
                    worker_uid=worker, worker_gid=worker_gid,
                    owner_uid=0,
                )
                self.assertEqual(stats, {"entries": 3,
                                         "bytes": len("#!/bin/sh\nexit 0\n") + len("archive entry")})
                self.assertEqual(os.fstat(fd).st_uid, 0)
                self.assertEqual(os.fstat(fd).st_mode & 0o777, 0o550)
                bin_fd = os.open("bin", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    file_fd = os.open("run.sh", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=bin_fd)
                    try:
                        file_info = os.fstat(file_fd)
                        self.assertEqual((file_info.st_uid, file_info.st_gid), (0, worker_gid))
                        self.assertEqual(file_info.st_mode & 0o777, 0o550)
                    finally:
                        os.close(file_fd)
                finally:
                    os.close(bin_fd)
            finally:
                process.wait()
                os.close(fd)
                os.close(cgroup_fd)

    @unittest.skipUnless(os.geteuid() == 0 and os.environ.get("WORKER_RELEASE_TEST_CGROUP_PATH"),
                         "requires root and a disposable dedicated cgroup v2 fixture")
    def test_rejects_late_entry_after_freeze_with_exact_membership_check(self):
        import pwd

        stage = pwd.getpwnam("nobody").pw_uid
        stage_gid = pwd.getpwnam("nobody").pw_gid
        worker = pwd.getpwnam("daemon").pw_uid
        worker_gid = pwd.getpwnam("daemon").pw_gid
        with tempfile.TemporaryDirectory() as temporary:
            os.chmod(temporary, 0o711)
            root = Path(temporary) / "incoming"
            root.mkdir(mode=0o700)
            (root / "a-file").write_text("file")
            os.chown(root / "a-file", stage, stage_gid)
            os.chown(root, stage, stage_gid)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(fd)
            cgroup_fd, cgroup_info = _open_test_cgroup(self)
            process = _dedicated_child(stage, stage_gid, root / "extracted-marker")
            original = freeze_module._freeze_directory

            def add_after_freeze(directory_fd, prefix, *args):
                original(directory_fd, prefix, *args)
                if prefix == "":
                    added = os.open("late", os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                                    0o600, dir_fd=directory_fd)
                    os.write(added, b"late")
                    os.fchown(added, stage, stage_gid)
                    os.close(added)

            try:
                _move_to_test_cgroup(self, cgroup_fd, process)
                with patch.object(freeze_module, "_freeze_directory", add_after_freeze):
                    with self.assertRaisesRegex(FreezeRejected, "membership"):
                        freeze_staged_tree(
                            fd, process, expected_dev=info.st_dev, expected_ino=info.st_ino,
                            extractor_uid=stage, extractor_gid=stage_gid,
                            cgroup_fd=cgroup_fd, expected_cgroup_dev=cgroup_info.st_dev,
                            expected_cgroup_ino=cgroup_info.st_ino,
                            worker_uid=worker, worker_gid=worker_gid,
                            owner_uid=0,
                        )
                self.assertTrue((root / "late").exists())
            finally:
                process.wait()
                os.close(fd)
                os.close(cgroup_fd)

    @unittest.skipUnless(os.geteuid() == 0 and os.environ.get("WORKER_RELEASE_TEST_CGROUP_PATH"),
                         "requires root and a disposable dedicated cgroup v2 fixture")
    def test_timeout_refuses_transfer_until_caller_drains_cgroup(self):
        import pwd

        stage = pwd.getpwnam("nobody").pw_uid
        stage_gid = pwd.getpwnam("nobody").pw_gid
        worker = pwd.getpwnam("daemon").pw_uid
        worker_gid = pwd.getpwnam("daemon").pw_gid
        with tempfile.TemporaryDirectory() as temporary:
            os.chmod(temporary, 0o711)
            root = Path(temporary) / "incoming"
            root.mkdir(mode=0o700)
            os.chown(root, stage, stage_gid)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(fd)
            cgroup_fd, cgroup_info = _open_test_cgroup(self)
            process = _dedicated_child(stage, stage_gid, None, sleep_seconds=3,
                                       spawn_descendant=True)
            try:
                _move_to_test_cgroup(self, cgroup_fd, process)
                with patch.object(freeze_module, "EXTRACTOR_WAIT_SECONDS", 0.01):
                    with self.assertRaisesRegex(FreezeRejected, "caller must kill its entire cgroup"):
                        freeze_staged_tree(
                            fd, process, expected_dev=info.st_dev, expected_ino=info.st_ino,
                            extractor_uid=stage, extractor_gid=stage_gid,
                            cgroup_fd=cgroup_fd, expected_cgroup_dev=cgroup_info.st_dev,
                            expected_cgroup_ino=cgroup_info.st_ino,
                            worker_uid=worker, worker_gid=worker_gid, owner_uid=0,
                        )
                self.assertEqual(os.fstat(fd).st_uid, stage)
                process.kill()
                process.wait()
                with self.assertRaises(CgroupProofRejected):
                    require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
                _kill_cgroup_and_wait_empty(self, cgroup_fd, cgroup_info)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                os.close(fd)
                os.close(cgroup_fd)



if __name__ == "__main__":
    unittest.main()
