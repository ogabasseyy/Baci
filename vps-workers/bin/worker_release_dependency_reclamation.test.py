from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_reclamation import (
    move_worker_install_tree,
    reclaim_workspace_node_modules,
    remove_verified_scratch_subtree,
)


class DependencyReclamationTests(unittest.TestCase):
    def test_fixed_scratch_removal_does_not_follow_nested_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            target = scratch / "source/node_modules"
            target.mkdir(parents=True)
            (target / "entry").write_text("generated", encoding="utf-8")
            outside = root / "outside"
            outside.mkdir()
            sentinel = outside / "keep"
            sentinel.write_text("preserve", encoding="utf-8")
            (target / "link").symlink_to(outside, target_is_directory=True)

            remove_verified_scratch_subtree(scratch, "source/node_modules", owner_uid=os.getuid())

            self.assertFalse(target.exists())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve")

    def test_fixed_scratch_removal_rejects_a_link_as_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            outside = root / "outside"
            outside.mkdir()
            (outside / "keep").write_text("preserve", encoding="utf-8")
            (scratch / "pnpm-store").symlink_to(outside, target_is_directory=True)

            with self.assertRaisesRegex(BuilderRejected, "target ownership or type"):
                remove_verified_scratch_subtree(scratch, "pnpm-store", owner_uid=os.getuid())
            self.assertTrue((outside / "keep").is_file())
            self.assertTrue((scratch / "pnpm-store").is_symlink())

    def test_workspace_reclamation_covers_nested_pnpm_layout_without_following_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            source = scratch / "source"
            (source / "apps/web/node_modules/.pnpm").mkdir(parents=True)
            (source / "node_modules/.pnpm").mkdir(parents=True)
            (source / "apps/web/node_modules/.pnpm/entry").write_text("web", encoding="utf-8")
            (source / "node_modules/.pnpm/entry").write_text("root", encoding="utf-8")
            outside = root / "outside"
            outside.mkdir()
            sentinel = outside / "keep"
            sentinel.write_text("preserve", encoding="utf-8")
            (source / "apps/web/node_modules/.pnpm/outside").symlink_to(
                outside, target_is_directory=True)

            removed = reclaim_workspace_node_modules(scratch, owner_uid=os.getuid())

            self.assertEqual(removed, 2)
            self.assertFalse((source / "node_modules").exists())
            self.assertFalse((source / "apps/web/node_modules").exists())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve")

    def test_workspace_reclamation_rejects_linked_node_modules_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            source = scratch / "source"
            source.mkdir(mode=0o700)
            outside = root / "outside"
            outside.mkdir()
            (outside / "keep").write_text("preserve", encoding="utf-8")
            (source / "node_modules").symlink_to(outside, target_is_directory=True)

            with self.assertRaisesRegex(BuilderRejected, "install tree ownership or type"):
                reclaim_workspace_node_modules(scratch, owner_uid=os.getuid())
            self.assertTrue((source / "node_modules").is_symlink())
            self.assertTrue((outside / "keep").is_file())

    def test_worker_install_promotion_preserves_tree_inode_and_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary) / "scratch"
            scratch.mkdir(mode=0o700)
            source = scratch / "source/vps-workers/node_modules"
            source.mkdir(parents=True)
            marker = source / "dotenv/index.js"
            marker.parent.mkdir()
            marker.write_text("module", encoding="utf-8")
            target_parent = scratch / "payload/root"
            target_parent.mkdir(parents=True)
            source_identity = source.stat().st_ino

            move_worker_install_tree(scratch, owner_uid=os.getuid())

            target = target_parent / "node_modules"
            self.assertFalse(source.exists())
            self.assertEqual(target.stat().st_ino, source_identity)
            self.assertEqual((target / "dotenv/index.js").read_text(encoding="utf-8"), "module")

    def test_worker_install_promotion_rejects_existing_candidate(self):
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary) / "scratch"
            scratch.mkdir(mode=0o700)
            source = scratch / "source/vps-workers/node_modules"
            source.mkdir(parents=True)
            (scratch / "payload/root/node_modules").mkdir(parents=True)

            with self.assertRaisesRegex(BuilderRejected, "destination already exists"):
                move_worker_install_tree(scratch, owner_uid=os.getuid())
            self.assertTrue(source.is_dir())


if __name__ == "__main__":
    unittest.main()
