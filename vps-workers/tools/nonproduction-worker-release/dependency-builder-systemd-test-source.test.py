from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from dependency_builder_systemd_test_source import (
    SOURCE_FILES, SyntheticSourceRejected, copy_snapshot,
)


class SyntheticSourceSnapshotTests(unittest.TestCase):
    def _workspace(self, root: Path) -> Path:
        workspace = root / "workspace"
        (workspace / "apps/web").mkdir(parents=True)
        (workspace / "vps-workers").mkdir(parents=True)
        for relative in SOURCE_FILES:
            path = workspace / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(f"fixture:{relative}\n", encoding="utf-8")
        return workspace

    def test_generated_pnpm_links_and_metadata_never_enter_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = self._workspace(root)
            generated = workspace / "node_modules/.bin/generated-fixture-entry"
            generated.parent.mkdir(parents=True)
            generated.symlink_to(root)
            (workspace / "pnpm-workspace-state.json").write_text("mutable state\n", encoding="utf-8")
            snapshot = root / "snapshot"

            copy_snapshot(workspace, snapshot)

            copied = {path.relative_to(snapshot).as_posix() for path in snapshot.rglob("*")}
            self.assertEqual(copied, set(SOURCE_FILES) | {"apps", "apps/web", "vps-workers"})
            self.assertFalse(any(path.is_symlink() for path in snapshot.rglob("*")))
            for relative in SOURCE_FILES:
                path = snapshot / relative
                self.assertEqual(path.read_text(encoding="utf-8"), f"fixture:{relative}\n")
                self.assertEqual(path.stat().st_mode & 0o222, 0)

    def test_pnpm_preverification_cannot_mutate_the_published_source_snapshot(self):
        script = Path(__file__).with_name("dependency-builder-systemd-test-seed.sh")
        source = script.read_text(encoding="utf-8")
        self.assertIn('--preverify --source "$pnpm_workspace_root"', source)
        self.assertIn('source, cache, store, seeds = map(Path, sys.argv[1:5])', source)
        self.assertIn('published = publish_seed(source, cache, store, seeds, sha', source)
        self.assertIn('"$seed_root" "$cache_root" "$store_root" "$published_seed_root"', source)

    def test_required_source_symlink_fails_closed_without_following_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = self._workspace(root)
            outside = root / "outside-lock"
            outside.write_text("preserve\n", encoding="utf-8")
            (workspace / "pnpm-lock.yaml").unlink()
            (workspace / "pnpm-lock.yaml").symlink_to(outside)

            with self.assertRaisesRegex(SyntheticSourceRejected, "bounded regular file"):
                copy_snapshot(workspace, root / "snapshot")
            self.assertEqual(outside.read_text(encoding="utf-8"), "preserve\n")
            self.assertFalse((root / "snapshot").exists())


if __name__ == "__main__":
    unittest.main()
