from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("worker_release_seed_workspace.py")
SPEC = importlib.util.spec_from_file_location("seed_workspace_under_test", MODULE_PATH)
seed_workspace = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(seed_workspace)
from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_paths import (
    ensure_seed_collection, ensure_seed_workspace_directories, rename_noreplace,
)


class SeedWorkspaceContractTests(unittest.TestCase):
    def test_fixed_parent_and_mountpoint_are_created_once_with_exact_modes(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            os.chmod(parent, 0o700)
            first = ensure_seed_workspace_directories(parent, owner_uid=os.getuid())
            second = ensure_seed_workspace_directories(parent, owner_uid=os.getuid())
            self.assertEqual(first, second)
            release_root = parent / "baci-worker-release"
            workspace = release_root / "seed-work"
            self.assertEqual(release_root.stat().st_mode & 0o777, 0o755)
            self.assertEqual(workspace.stat().st_mode & 0o777, 0o700)

    def test_fixed_parent_symlink_and_nonempty_mountpoint_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            os.chmod(parent, 0o700)
            outside = parent / "outside"
            outside.mkdir(mode=0o700)
            (parent / "baci-worker-release").symlink_to(outside, target_is_directory=True)
            with self.assertRaisesRegex(BuilderRejected, "unsafe"):
                ensure_seed_workspace_directories(parent, owner_uid=os.getuid())

        with tempfile.TemporaryDirectory() as temp:
            parent = Path(temp)
            os.chmod(parent, 0o700)
            workspace = parent / "baci-worker-release" / "seed-work"
            workspace.mkdir(mode=0o700, parents=True)
            (workspace / "unexpected").touch()
            with self.assertRaisesRegex(BuilderRejected, "not empty"):
                ensure_seed_workspace_directories(parent, owner_uid=os.getuid())

    def test_seed_collection_is_created_inside_exact_private_mount(self):
        with tempfile.TemporaryDirectory() as temp:
            mount = Path(temp)
            os.chmod(mount, 0o700)
            first = ensure_seed_collection(mount, owner_uid=os.getuid())
            second = ensure_seed_collection(mount, owner_uid=os.getuid())
            self.assertEqual(first, second)
            self.assertEqual((mount / "seeds").stat().st_mode & 0o777, 0o700)

    def test_capacity_covers_observed_lower_bound_with_twofold_headroom(self):
        self.assertGreaterEqual(seed_workspace.IMAGE_BYTES,
                                seed_workspace.EXPECTED_OBSERVED_BYTES * 2)
        self.assertGreaterEqual(seed_workspace.INODE_COUNT,
                                seed_workspace.EXPECTED_OBSERVED_INODES * 2)

    def test_mount_is_fixed_non_executable_and_required_before_broker(self):
        self.assertEqual(seed_workspace.UNIT_NAME,
                         r"var-cache-baci\x2dworker\x2drelease-seed\x2dwork.mount")
        unit = seed_workspace.mount_unit_contents().decode("ascii")
        self.assertIn(f"What={seed_workspace.IMAGE}\n", unit)
        self.assertIn(f"Where={seed_workspace.WORK_ROOT}\n", unit)
        self.assertIn("Options=loop,nosuid,nodev,noexec", unit)
        self.assertIn("Before=local-fs.target baci-worker-release-broker.service", unit)
        self.assertIn("WantedBy=local-fs.target", unit)

    @unittest.skipUnless(sys.platform == "linux", "renameat2 is a Linux kernel interface")
    def test_no_replace_atomic_rename_preserves_source_on_collision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                (root / "source").write_text("new", encoding="ascii")
                (root / "destination").write_text("old", encoding="ascii")
                with self.assertRaises(FileExistsError):
                    rename_noreplace(root_fd, "source", "destination")
                self.assertEqual((root / "source").read_text(encoding="ascii"), "new")
                self.assertEqual((root / "destination").read_text(encoding="ascii"), "old")
                (root / "destination").unlink()
                rename_noreplace(root_fd, "source", "destination")
                info = (root / "destination").lstat()
                self.assertEqual(info.st_nlink, 1)
                self.assertFalse((root / "source").exists())
            finally:
                os.close(root_fd)

    def test_host_capacity_requires_image_reserve_and_inode_headroom(self):
        fake = SimpleNamespace(f_bavail=1, f_frsize=1, f_favail=1)
        with patch.object(seed_workspace, "_trusted_directory"), \
             patch.object(seed_workspace.os, "statvfs", return_value=fake):
            with self.assertRaisesRegex(BuilderRejected, "lacks seed-image"):
                seed_workspace.host_capacity(parent=Path("/tmp"))

    def test_postallocation_headroom_covers_published_seed_and_reserve(self):
        fake = SimpleNamespace(
            f_bavail=seed_workspace.PUBLISHED_SEED_ROOT_MAX_BYTES + seed_workspace.HOST_RESERVE_BYTES,
            f_frsize=1, f_favail=seed_workspace.MIN_HOST_FREE_INODES,
        )
        with patch.object(seed_workspace, "_trusted_directory"), \
             patch.object(seed_workspace.os, "statvfs", return_value=fake):
            self.assertEqual(seed_workspace.host_capacity(
                parent=Path("/tmp"),
                minimum_bytes=seed_workspace.PUBLISHED_SEED_ROOT_MAX_BYTES
                + seed_workspace.HOST_RESERVE_BYTES,
            ), (fake.f_bavail, fake.f_favail))

    def test_rollback_refuses_a_mounted_workspace(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "image"
            workspace = root / "workspace"
            unit_dir = root / "units"
            workspace.mkdir()
            unit_dir.mkdir()
            image.write_bytes(b"new image")
            identity = image.stat().st_dev, image.stat().st_ino
            with patch.object(seed_workspace.os.path, "ismount", return_value=True):
                with self.assertRaisesRegex(BuilderRejected, "refuses a mounted"):
                    seed_workspace.rollback_created_state(
                        lambda args, **_kwargs: SimpleNamespace(
                            stdout="" if args[0].endswith("losetup") else "inactive",
                            returncode=0,
                        ),
                        image=image, workspace=workspace, unit_dir=unit_dir,
                        unit_name="fixed.mount", unit_contents=b"unit\n",
                        image_identity=identity, unit_created=False,
                    )
            self.assertTrue(image.exists())

    def test_rollback_checks_image_inode_before_unlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "image"
            workspace = root / "workspace"
            unit_dir = root / "units"
            workspace.mkdir()
            unit_dir.mkdir()
            image.write_bytes(b"replacement")
            with patch.object(seed_workspace.os.path, "ismount", return_value=False):
                with self.assertRaisesRegex(BuilderRejected, "inode changed"):
                    seed_workspace.rollback_created_state(
                        lambda *_args, **_kwargs: None, image=image, workspace=workspace,
                        unit_dir=unit_dir, unit_name="fixed.mount", unit_contents=b"unit\n",
                        image_identity=(0, 1), unit_created=False,
                    )
            self.assertTrue(image.exists())

    def test_rollback_removes_only_its_exact_unit_and_image(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "image"
            workspace = root / "workspace"
            unit_dir = root / "units"
            workspace.mkdir()
            unit_dir.mkdir()
            image.write_bytes(b"new image")
            unit = unit_dir / "fixed.mount"
            payload = b"[Mount]\nWhere=/fixed\n"
            unit.write_bytes(payload)
            calls = []

            def runner(args, **_kwargs):
                calls.append(args)
                output = "" if args[0].endswith("losetup") else "inactive\n"
                return SimpleNamespace(stdout=output, returncode=0)

            identity = image.stat().st_dev, image.stat().st_ino
            with patch.object(seed_workspace.os.path, "ismount", return_value=False):
                seed_workspace.rollback_created_state(
                    runner, image=image, workspace=workspace, unit_dir=unit_dir,
                    unit_name="fixed.mount", unit_contents=payload,
                        image_identity=identity, unit_created=True, owner_uid=os.getuid(),
                )
            self.assertFalse(image.exists())
            self.assertFalse(unit.exists())
            self.assertEqual(calls[0][1:4], ("disable", "--now", "fixed.mount"))
            self.assertEqual(calls[-1][1:], ("daemon-reload",))

    def test_rollback_preserves_unrecognized_mount_unit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "image"
            workspace = root / "workspace"
            unit_dir = root / "units"
            workspace.mkdir()
            unit_dir.mkdir()
            image.write_bytes(b"new image")
            (unit_dir / "fixed.mount").write_bytes(b"other")
            identity = image.stat().st_dev, image.stat().st_ino
            with patch.object(seed_workspace.os.path, "ismount", return_value=False):
                with self.assertRaisesRegex(BuilderRejected, "unit identity changed"):
                    seed_workspace.rollback_created_state(
                        lambda args, **_kwargs: SimpleNamespace(
                            stdout="" if args[0].endswith("losetup") else "inactive",
                            returncode=0,
                        ),
                        image=image, workspace=workspace, unit_dir=unit_dir,
                        unit_name="fixed.mount", unit_contents=b"unit\n",
                        image_identity=identity, unit_created=True, owner_uid=os.getuid(),
                    )
            self.assertTrue(image.exists())
            self.assertTrue((unit_dir / "fixed.mount").exists())


if __name__ == "__main__":
    unittest.main()
