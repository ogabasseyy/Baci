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
import worker_release_descriptor_cgroup as cgroup_module


class DescriptorFreezeCgroupIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(os.geteuid() == 0 and os.environ.get("WORKER_RELEASE_TEST_CGROUP_PATH"),
                         "requires root and a disposable dedicated cgroup v2 fixture")
    def test_freezes_tree_after_reaped_dedicated_uid_archive_writer(self):
        import pwd

        stage = pwd.getpwnam("nobody").pw_uid
        stage_gid = pwd.getpwnam("nobody").pw_gid
        worker = pwd.getpwnam("daemon").pw_uid
        worker_gid = pwd.getpwnam("daemon").pw_gid
        with tempfile.TemporaryDirectory() as temporary:
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


def _dedicated_child(uid, gid, marker, *, sleep_seconds=1, spawn_descendant=False):
    def drop_identity():
        os.setgroups([])
        os.setgid(gid)
        os.setuid(uid)

    return subprocess.Popen(
        [sys.executable, "-c",
         "import pathlib,subprocess,sys,time; sys.stdin.readline(); "
         "pathlib.Path(sys.argv[1]).write_text('archive entry') if sys.argv[1] else None; "
         "subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']) if sys.argv[3]=='descendant' else None; "
         "print('READY',flush=True); "
         "time.sleep(float(sys.argv[2]))",
         str(marker) if marker else "", str(sleep_seconds),
         "descendant" if spawn_descendant else "none"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        preexec_fn=drop_identity,
    )


def _open_test_cgroup(test):
    raw = os.environ.get("WORKER_RELEASE_TEST_CGROUP_PATH", "")
    requested = Path(raw)
    if (requested.parent != Path("/sys/fs/cgroup")
            or not requested.name.startswith("worker-release-test-")
            or not requested.name.replace("-", "").isalnum()):
        test.skipTest("cgroup path is not a designated disposable test cgroup")
    root_fd = _open_directory_path_nofollow(Path("/sys/fs/cgroup"))
    try:
        fd = _open_child_directory_nofollow(root_fd, requested.name)
        try:
            cgroup_module._require_cgroup2_fd(fd, os.fstat(fd).st_dev, os.fstat(fd).st_ino)
        except Exception:
            os.close(fd)
            raise
        return fd, os.fstat(fd)
    finally:
        os.close(root_fd)



def _open_directory_path_nofollow(path):
    if not path.is_absolute():
        raise OSError("directory path must be absolute")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:]:
            child = _open_child_directory_nofollow(fd, component)
            os.close(fd)
            fd = child
        result, fd = fd, -1
        return result
    finally:
        if fd >= 0:
            os.close(fd)


def _open_child_directory_nofollow(parent_fd, name):
    if name in ("", ".", "..") or "/" in name or "\\" in name:
        raise OSError("unsafe directory component")
    before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if not stat.S_ISDIR(before.st_mode):
        raise OSError("path component is not a real directory")
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    opened = os.fstat(fd)
    if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
        os.close(fd)
        raise OSError("directory path component changed during open")
    return fd


def _move_to_test_cgroup(test, cgroup_fd, process):
    try:
        fd = os.open("cgroup.procs", os.O_WRONLY | os.O_NOFOLLOW, dir_fd=cgroup_fd)
        try:
            os.write(fd, f"{process.pid}\n".encode("ascii"))
        finally:
            os.close(fd)
        assert process.stdin is not None
        process.stdin.write(b"go\n")
        process.stdin.flush()
        assert process.stdout is not None
        if process.stdout.readline() != b"READY\n":
            test.fail("dedicated child did not reach its ready state")
    except OSError as exc:
        if process.poll() is None:
            process.kill()
            process.wait()
        test.skipTest(f"designated cgroup fixture is not writable: {type(exc).__name__}")


def _kill_cgroup_and_wait_empty(test, cgroup_fd, cgroup_info):
    try:
        kill_fd = os.open("cgroup.kill", os.O_WRONLY | os.O_NOFOLLOW, dir_fd=cgroup_fd)
        try:
            os.write(kill_fd, b"1")
        finally:
            os.close(kill_fd)
        deadline = __import__("time").monotonic() + 5
        while __import__("time").monotonic() < deadline:
            try:
                require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
                return
            except CgroupProofRejected:
                __import__("time").sleep(0.05)
        test.fail("test cgroup did not drain after cgroup.kill")
    except OSError as exc:
        test.fail(f"test cgroup cleanup failed: {type(exc).__name__}")


if __name__ == "__main__":
    unittest.main()
