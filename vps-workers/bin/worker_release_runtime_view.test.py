"""Root-only tests for root-owned runtime candidate mountpoints."""
from __future__ import annotations

import os
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_runtime_view import RuntimeViewRejected, create_runtime_view


UNIT = "baci-worker-runtime-aaaaaaaaaaaaaaaa-bbbbbbbbbbbb-0.service"


@unittest.skipUnless(os.geteuid() == 0, "requires root-owned mountpoint fixture")
class RuntimeViewTests(unittest.TestCase):
    def setUp(self):
        self.identity_patch = patch("worker_release_runtime_view.runtime_verifier_identity",
                                     return_value=(61000, 61000))
        self.identity_patch.start()
        self.temp = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temp.name) / "views"
        self.root.mkdir(mode=0o711)
        self.candidate = Path(self.temp.name) / (
            "." + "c" * 40 + ".incoming." + "d" * 32)
        self.candidate.mkdir()

    def make_view(self, unit=UNIT):
        info = self.candidate.lstat()
        return create_runtime_view(
            unit, candidate_path=self.candidate, fence_digest="a" * 64,
            runtime_uid=61000,
            candidate_identity=(info.st_dev, info.st_ino), view_root=self.root)

    def tearDown(self):
        self.identity_patch.stop()
        self.temp.cleanup()

    def test_view_is_root_owned_exact_and_removed_after_proven_unit_cleanup(self):
        view = self.make_view()
        view.verify_target()
        self.assertEqual(view.path.stat().st_uid, 0)
        self.assertEqual(stat.S_IMODE(view.path.stat().st_mode), 0o711)
        self.assertEqual(view.candidate_path.stat().st_uid, 0)
        self.assertEqual(stat.S_IMODE(view.candidate_path.stat().st_mode), 0o700)
        view.cleanup()
        self.assertFalse(view.path.exists())
        self.assertFalse(view.candidate_path.exists())

    def test_existing_transaction_or_symlink_cannot_be_claimed(self):
        view = self.make_view()
        view.abandon()
        with self.assertRaisesRegex(RuntimeViewRejected, "already exists"):
            self.make_view()
        other = "baci-worker-runtime-cccccccccccccccc-dddddddddddd-1.service"
        (self.root / other).symlink_to(self.root / UNIT)
        with self.assertRaises(RuntimeViewRejected):
            info = self.candidate.lstat()
            create_runtime_view(other, candidate_path=self.candidate,
                                fence_digest="c" * 64,
                                runtime_uid=61000,
                                candidate_identity=(info.st_dev, info.st_ino),
                                view_root=self.root)

    def test_cleanup_rejects_replaced_mountpoint_without_removing_replacement(self):
        view = self.make_view()
        pinned = os.fstat(view.mountpoint_fd)
        view.candidate_path.rmdir()
        view.candidate_path.mkdir(mode=0o700)
        replacement = view.candidate_path.stat()
        self.assertNotEqual((replacement.st_dev, replacement.st_ino),
                            (pinned.st_dev, pinned.st_ino))
        with self.assertRaisesRegex(RuntimeViewRejected, "mountpoint changed"):
            view.cleanup()
        self.assertTrue(view.candidate_path.is_dir())
        view.abandon()

    def test_cleanup_rejects_nonempty_mountpoint(self):
        view = self.make_view()
        (view.candidate_path / "unexpected").mkdir()
        with self.assertRaisesRegex(RuntimeViewRejected, "not empty"):
            view.cleanup()

    def test_cleanup_rejects_replaced_view_root_path(self):
        view = self.make_view()
        moved = self.root.with_name("views-moved")
        self.root.rename(moved)
        self.root.mkdir(mode=0o711)
        with self.assertRaisesRegex(RuntimeViewRejected, "path identity changed"):
            view.cleanup()
        self.assertTrue((moved / UNIT / "candidate").is_dir())
        self.assertFalse((self.root / UNIT).exists())

    def test_unit_name_is_fixed_and_transaction_bound(self):
        with self.assertRaisesRegex(RuntimeViewRejected, "transaction-bound"):
            self.make_view("../runtime.service")

    def test_view_requires_the_configured_dedicated_uid(self):
        info = self.candidate.lstat()
        with self.assertRaisesRegex(RuntimeViewRejected, "UID is outside fixed"):
            create_runtime_view(UNIT, candidate_path=self.candidate,
                                fence_digest="a" * 64, runtime_uid=61001,
                                candidate_identity=(info.st_dev, info.st_ino),
                                view_root=self.root)


if __name__ == "__main__":
    unittest.main()
