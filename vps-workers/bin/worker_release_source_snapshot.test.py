from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_dependency_artifacts import BuilderRejected
import worker_release_source_snapshot as snapshots
from worker_release_source_snapshot import pin_source_snapshot


class PinnedSourceSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="baci-source-snapshot-", dir=Path.home())
        self.base = Path(self.temp.name)
        self.anchor = self.base / "inputs"
        self.anchor.mkdir(mode=0o700)
        self.snapshot = self.anchor / "source-a"
        self._create_snapshot(self.snapshot)

    def tearDown(self):
        for current, directories, _files in os.walk(self.base, topdown=False, followlinks=False):
            for name in directories:
                child = Path(current) / name
                if child.is_dir() and not child.is_symlink():
                    child.chmod(0o700)
        self.temp.cleanup()

    @staticmethod
    def _create_snapshot(path: Path, content: bytes = b"locked source\n"):
        path.mkdir(mode=0o750)
        (path / "pkg").mkdir(mode=0o750)
        (path / "pkg" / "package.json").write_bytes(content)
        (path / "pkg" / "package.json").chmod(0o440)
        (path / "pkg").chmod(0o550)
        path.chmod(0o550)

    def _pin(self, path=None, anchor=None, **limits):
        return pin_source_snapshot(path or self.snapshot, trusted_root=anchor or self.anchor,
                                   owner_uid=os.geteuid(), **limits)

    def test_unchanged_frozen_snapshot_passes_and_close_releases_pin(self):
        with self._pin() as pinned:
            self.assertEqual(len(pinned.digest), 64)
            pinned.verify_unchanged()
        with self.assertRaisesRegex(BuilderRejected, "pin is closed"):
            pinned.verify_unchanged()

    def test_sibling_result_directory_changes_do_not_invalidate_snapshot_path(self):
        with self._pin() as pinned:
            sibling = self.anchor / ".source-view-build-result"
            sibling.mkdir(mode=0o700)
            (sibling / "output").write_text("builder output\n")
            pinned.verify_unchanged()
            shutil.rmtree(sibling)
            pinned.verify_unchanged()

    def test_content_change_after_build_is_detected_even_when_modes_are_restored(self):
        with self._pin() as pinned:
            file = self.snapshot / "pkg" / "package.json"
            file.chmod(0o640)
            file.write_bytes(b"changed source\n")
            file.chmod(0o440)
            with self.assertRaisesRegex(BuilderRejected, "contents changed"):
                pinned.verify_unchanged()

    def test_snapshot_path_replacement_with_matching_content_is_detected(self):
        with self._pin() as pinned:
            moved = self.anchor / "source-old"
            self.snapshot.rename(moved)
            self._create_snapshot(self.snapshot)
            with self.assertRaisesRegex(BuilderRejected, "ancestor path changed|root path changed"):
                pinned.verify_unchanged()

    def test_trusted_ancestor_replacement_is_detected(self):
        with self._pin() as pinned:
            moved = self.base / "inputs-old"
            self.anchor.rename(moved)
            self.anchor.mkdir(mode=0o700)
            self._create_snapshot(self.anchor / "source-a")
            with self.assertRaisesRegex(BuilderRejected, "ancestor path changed"):
                pinned.verify_unchanged()

    def test_group_or_world_writable_ancestor_is_rejected(self):
        self.base.chmod(0o707)
        try:
            with self.assertRaisesRegex(BuilderRejected, "ancestor is not trusted"):
                self._pin()
        finally:
            self.base.chmod(0o700)

    def test_symlink_in_trusted_ancestor_chain_is_rejected(self):
        link = self.base / "input-link"
        link.symlink_to(self.anchor, target_is_directory=True)
        with self.assertRaises((BuilderRejected, OSError)):
            self._pin(anchor=link)

    def test_snapshot_tree_rejects_hardlinks_and_special_or_symlink_entries(self):
        outside = self.base / "outside"
        outside.write_bytes(b"outside\n")
        (self.snapshot / "pkg").chmod(0o750)
        (self.snapshot / "pkg" / "hardlink").hardlink_to(outside)
        (self.snapshot / "pkg").chmod(0o550)
        with self.assertRaisesRegex(BuilderRejected, "file ownership or mode is unsafe"):
            self._pin()
        (self.snapshot / "pkg").chmod(0o750)
        (self.snapshot / "pkg" / "hardlink").unlink()
        (self.snapshot / "pkg" / "escape").symlink_to(outside)
        (self.snapshot / "pkg").chmod(0o550)
        with self.assertRaisesRegex(BuilderRejected, "symlink or special file"):
            self._pin()

    def test_entry_and_byte_caps_are_enforced(self):
        with self.assertRaisesRegex(BuilderRejected, "entry limit"):
            self._pin(max_entries=1)
        with self.assertRaisesRegex(BuilderRejected, "byte limit"):
            self._pin(max_bytes=1)

    def test_depth_and_relative_path_caps_are_enforced(self):
        with self.assertRaisesRegex(BuilderRejected, "depth limit"):
            self._pin(max_depth=1)
        with self.assertRaisesRegex(BuilderRejected, "relative path limit"):
            self._pin(max_path_bytes=2)
        with self.assertRaisesRegex(BuilderRejected, "bounds or location are invalid"):
            self._pin(max_depth=snapshots.MAX_SNAPSHOT_DEPTH + 1)

    def test_file_metadata_transition_between_lstat_and_open_is_rejected(self):
        source_file = self.snapshot / "pkg" / "package.json"
        original_open = snapshots.os.open
        changed = False

        def change_mode_before_open(name, flags, *args, **kwargs):
            nonlocal changed
            if name == "package.json" and kwargs.get("dir_fd") is not None and not changed:
                source_file.chmod(0o550)
                changed = True
            return original_open(name, flags, *args, **kwargs)

        with patch.object(snapshots.os, "open", side_effect=change_mode_before_open):
            with self.assertRaisesRegex(BuilderRejected, "file changed before reading"):
                self._pin()
        self.assertTrue(changed)

    def test_directory_metadata_transition_between_lstat_and_open_is_rejected(self):
        source_dir = self.snapshot / "pkg"
        original_open = snapshots.os.open
        changed = False

        def change_mode_before_open(name, flags, *args, **kwargs):
            nonlocal changed
            if name == "pkg" and kwargs.get("dir_fd") is not None and not changed:
                source_dir.chmod(0o750)
                changed = True
            return original_open(name, flags, *args, **kwargs)

        with patch.object(snapshots.os, "open", side_effect=change_mode_before_open):
            with self.assertRaisesRegex(BuilderRejected, "directory changed during verification"):
                self._pin()
        self.assertTrue(changed)

    def test_snapshot_must_be_direct_child_of_private_trusted_root(self):
        nested = self.anchor / "nested"
        nested.mkdir(mode=0o700)
        with self.assertRaisesRegex(BuilderRejected, "location are invalid"):
            self._pin(path=nested / "snapshot")


if __name__ == "__main__":
    unittest.main()
