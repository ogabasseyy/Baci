#!/usr/bin/env python3
"""Disposable exact-mount contract tests; all system commands are mocked."""
from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import worker_release_seed_workspace_mount as mount
from worker_release_dependency_artifacts import BuilderRejected


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                     "fixed mount proof integration requires Linux root")
class SeedWorkspaceMountProofTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seed-mount-proof-", dir="/run")
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.image = self.root / "seed-work.img"
        self.image.write_bytes(b"x" * 64)
        self.image.chmod(0o600)
        self.workspace = self.root / "seed-work"
        self.workspace.mkdir(mode=0o700)
        (self.workspace / "seeds").mkdir(mode=0o700)
        self.calls = []
        self.systemd = {"What": "/dev/loop7", "Where": str(self.workspace),
                        "Type": "ext4", "Options": "nosuid,nodev,noexec",
                        "ActiveState": "active"}
        self.findmnt = {"SOURCE": "/dev/loop7", "FSTYPE": "ext4",
                        "OPTIONS": "rw,nosuid,nodev,noexec", "TARGET": str(self.workspace)}
        self.loop = {"BACK-FILE": str(self.image), "SIZELIMIT": "0"}
        self.patches = [
            patch.object(mount, "IMAGE", self.image),
            patch.object(mount, "WORK_ROOT", self.workspace),
            patch.object(mount, "SEED_ROOT", self.workspace / "seeds"),
            patch.object(mount, "UNIT_NAME", "fixed-seed-work.mount"),
            patch.object(mount, "IMAGE_BYTES", 64),
            patch.object(mount, "INODE_COUNT", 20),
            patch.object(mount.os, "statvfs", return_value=SimpleNamespace(
                f_blocks=64, f_frsize=1)),
            patch.object(mount.os.path, "ismount", return_value=True),
        ]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def runner(self, args, **_kwargs):
        self.calls.append(args)
        if args[0] == "/usr/bin/systemctl":
            key = next(arg.removeprefix("--property=") for arg in args
                       if arg.startswith("--property="))
            return SimpleNamespace(stdout=self.systemd[key] + "\n", returncode=0)
        if args[0] == "/usr/bin/findmnt":
            values = [self.findmnt[key] for key in ("SOURCE", "FSTYPE", "OPTIONS", "TARGET")]
            return SimpleNamespace(stdout=" ".join(values) + "\n", returncode=0)
        if args[0] == "/usr/sbin/losetup":
            self.assertEqual(args[-1], self.findmnt["SOURCE"])
            values = [self.loop[key] for key in ("BACK-FILE", "SIZELIMIT")]
            return SimpleNamespace(stdout=" ".join(values) + "\n", returncode=0)
        if args[0] == "/usr/sbin/tune2fs":
            return SimpleNamespace(stdout=(
                "Inode count: 20\nBlock count: 64\nBlock size: 1\n"), returncode=0)
        raise AssertionError("unexpected command in fixed mount proof")

    def test_requires_full_fixed_mount_image_and_seed_root_proof(self):
        identity = self.image.stat().st_dev, self.image.stat().st_ino
        capacity, inodes = mount.verify_bounded_seed_workspace(
            runner=self.runner, image_identity=identity,
        )
        self.assertEqual((capacity, inodes), (64, 20))
        self.assertEqual(len(self.calls), 6)

    def test_plain_host_directory_is_not_accepted_as_quota_mount(self):
        with patch.object(mount.os.path, "ismount", return_value=False):
            with self.assertRaisesRegex(BuilderRejected, "not mounted"):
                mount.verify_bounded_seed_workspace(runner=self.runner)
        self.assertEqual(self.calls, [])

    def test_systemd_mount_must_have_exact_target_type_and_active_state(self):
        invalid_properties = (("Where", "/other/target"),
                              ("Type", "xfs"),
                              ("ActiveState", "inactive"))
        for key, value in invalid_properties:
            with self.subTest(key=key, value=value):
                self.systemd[key] = value
                self.calls.clear()
                with self.assertRaisesRegex(BuilderRejected,
                                            "systemd mount contract differs"):
                    mount.verify_bounded_seed_workspace(runner=self.runner)
                self.assertFalse(any(call[0] == "/usr/bin/findmnt" for call in self.calls))
                self.systemd[key] = {"Where": str(self.workspace),
                                     "Type": "ext4", "ActiveState": "active"}[key]

    def test_wrong_loop_backing_file_is_rejected(self):
        self.loop["BACK-FILE"] = "/other/image"
        with self.assertRaisesRegex(BuilderRejected, "backing file differs"):
            mount.verify_bounded_seed_workspace(runner=self.runner)

    def test_loop_device_must_be_limited_to_the_fixed_image_size(self):
        self.loop["SIZELIMIT"] = "4096"
        with self.assertRaisesRegex(BuilderRejected, "backing file differs"):
            mount.verify_bounded_seed_workspace(runner=self.runner)

    def test_effective_mount_flags_must_be_safe(self):
        unsafe_options = (
            "rw,nodev,noexec",  # missing nosuid
            "rw,nosuid,noexec",  # missing nodev
            "rw,nosuid,nodev",  # missing noexec
            "rw,nosuid,nodev,noexec,exec",
            "rw,nosuid,nodev,noexec,dev",
            "rw,nosuid,nodev,noexec,suid",
        )
        for options in unsafe_options:
            with self.subTest(options=options):
                self.findmnt["OPTIONS"] = options
                with self.assertRaisesRegex(BuilderRejected, "mount source or options are unsafe"):
                    mount.verify_bounded_seed_workspace(runner=self.runner)

    def test_mount_must_be_the_exact_ext4_loop_target(self):
        invalid_mounts = (
            ("/dev/sda1", "ext4", "rw,nosuid,nodev,noexec", str(self.workspace)),
            ("/dev/loop7", "xfs", "rw,nosuid,nodev,noexec", str(self.workspace)),
            ("/dev/loop7", "ext4", "rw,nosuid,nodev,noexec", str(self.root)),
        )
        for source, filesystem, options, target in invalid_mounts:
            with self.subTest(source=source, filesystem=filesystem, target=target):
                self.findmnt.update(SOURCE=source, FSTYPE=filesystem,
                                    OPTIONS=options, TARGET=target)
                with self.assertRaisesRegex(BuilderRejected, "mount source or options are unsafe"):
                    mount.verify_bounded_seed_workspace(runner=self.runner)

    def test_missing_protected_seed_child_is_rejected(self):
        (self.workspace / "seeds").rmdir()
        with self.assertRaises(BuilderRejected):
            mount.verify_bounded_seed_workspace(runner=self.runner)


if __name__ == "__main__":
    unittest.main()
