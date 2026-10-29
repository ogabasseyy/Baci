import os
import importlib.util
import io
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_descriptor_freeze import FreezeRejected, freeze_staged_tree
import worker_release_descriptor_freeze as freeze_module
from worker_release_descriptor_cgroup import (
    CgroupProofRejected,
    parse_cgroup_procs,
    parse_populated,
    require_empty_cgroup,
)


class DescriptorFreezeTests(unittest.TestCase):
    def test_cgroup_harness_only_skips_when_capability_is_optional(self):
        harness_path = (Path(__file__).parents[1] / "tools" /
                        "worker-release-descriptor-freeze-cgroup-ci.py")
        spec = importlib.util.spec_from_file_location("descriptor_cgroup_harness", harness_path)
        harness = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(harness)
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stdout(output):
            self.assertEqual(harness._capability_unavailable("missing test capability"), 0)
        self.assertTrue(output.getvalue().startswith("SKIP:"))
        output = io.StringIO()
        with patch.dict(os.environ, {"WORKER_RELEASE_REQUIRE_CGROUP": "1"}), \
                redirect_stdout(output):
            self.assertEqual(harness._capability_unavailable("missing test capability"), 1)
        self.assertTrue(output.getvalue().startswith("FAIL:"))

    def test_cgroup_harness_loads_exact_dot_test_module(self):
        harness_path = (Path(__file__).parents[1] / "tools" /
                        "worker-release-descriptor-freeze-cgroup-ci.py")
        spec = importlib.util.spec_from_file_location("descriptor_cgroup_harness", harness_path)
        harness = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(harness)
        modules = harness._load_freeze_tests()
        self.assertEqual(len(modules), 2)
        self.assertTrue(hasattr(modules[0], "DescriptorFreezeTests"))
        self.assertTrue(hasattr(modules[1], "DescriptorFreezeCgroupIntegrationTests"))

    def test_cleanup_rejects_replaced_or_symlinked_cgroup_path(self):
        harness_path = (Path(__file__).parents[1] / "tools" /
                        "worker-release-descriptor-freeze-cgroup-ci.py")
        spec = importlib.util.spec_from_file_location("descriptor_cgroup_harness", harness_path)
        harness = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(harness)
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            (parent / "original").mkdir()
            (parent / "replacement").mkdir()
            root_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                expected = os.stat("original", dir_fd=root_fd, follow_symlinks=False)
                with self.assertRaisesRegex(OSError, "inode"):
                    harness._verify_pinned_cgroup_path(root_fd, "replacement", expected)
                (parent / "link").symlink_to("original", target_is_directory=True)
                with self.assertRaises(OSError):
                    harness._verify_pinned_cgroup_path(root_fd, "link", expected)
            finally:
                os.close(root_fd)

    def test_preflight_byte_budget_counts_file_sizes_not_timestamps(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "incoming"
            root.mkdir()
            (root / "small").write_bytes(b"1234")
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                with patch.object(freeze_module, "MAX_BYTES", 4):
                    inventory = freeze_module._inventory_tree(
                        fd, os.fstat(fd).st_dev, os.geteuid(), os.getegid(),
                    )
                self.assertEqual(inventory["small"][7], 4)
            finally:
                os.close(fd)

    def test_cgroup_proof_parsers_fail_closed_on_ambiguous_input(self):
        self.assertEqual(parse_cgroup_procs(b"12\n34\n"), frozenset({12, 34}))
        self.assertFalse(parse_populated(b"populated 0\nfrozen 0\n"))
        self.assertTrue(parse_populated(b"populated 1\n"))
        for malformed in (b"", b"populated 0\npopulated 1\n", b"populated maybe\n"):
            with self.subTest(data=malformed), self.assertRaises(CgroupProofRejected):
                parse_populated(malformed)
        for malformed in (b"1\n1\n", b"0\n", b"abc\n"):
            with self.subTest(data=malformed), self.assertRaises(CgroupProofRejected):
                parse_cgroup_procs(malformed)

    def test_requires_distinct_extractor_worker_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "incoming"
            root.mkdir(mode=0o700)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(fd)
            process = subprocess.Popen([sys.executable, "-c", "pass"], stdout=subprocess.DEVNULL)
            try:
                with self.assertRaisesRegex(FreezeRejected, "identities must be distinct"):
                    freeze_staged_tree(
                        fd, process, expected_dev=info.st_dev, expected_ino=info.st_ino,
                        extractor_uid=os.geteuid(), extractor_gid=os.getegid(), worker_uid=os.geteuid(),
                    cgroup_fd=fd, expected_cgroup_dev=info.st_dev,
                    expected_cgroup_ino=info.st_ino,
                    worker_gid=os.getegid(), owner_uid=os.geteuid(),
                    )
            finally:
                process.wait()
                os.close(fd)

    def test_temp_directory_is_not_accepted_as_kernel_cgroup_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            fd = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            info = os.fstat(fd)
            try:
                with self.assertRaises(CgroupProofRejected):
                    require_empty_cgroup(fd, info.st_dev, info.st_ino)
            finally:
                os.close(fd)

    def test_descriptor_relative_cgroup_directory_open_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            (parent / "real").mkdir()
            (parent / "link").symlink_to("real", target_is_directory=True)
            parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                child_fd = _open_child_directory_nofollow(parent_fd, "real")
                os.close(child_fd)
                with self.assertRaises(OSError):
                    _open_child_directory_nofollow(parent_fd, "link")
            finally:
                os.close(parent_fd)


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



if __name__ == "__main__":
    unittest.main()
