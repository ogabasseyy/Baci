from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from worker_release_actual_dependency_hardlinks import HardlinkBoundaryError

SCRIPT = Path(__file__).with_name("actual-dependency-experiment.py")
SPEC = importlib.util.spec_from_file_location("actual_dependency_experiment", SCRIPT)
assert SPEC and SPEC.loader
experiment = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(experiment)


class ActualDependencyTreeSizeTests(unittest.TestCase):
    def test_tree_size_measures_regular_content_and_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sub").mkdir()
            (root / "sub/payload").write_bytes(b"synthetic")
            entries, size = experiment.tree_size(root, max_entries=2, max_bytes=100)
            self.assertEqual(entries, 2)
            self.assertEqual(size, len(b"synthetic"))

    def test_tree_size_rejects_symlink_and_hardlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.write_text("synthetic", encoding="utf-8")
            (root / "escape").symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                experiment.tree_size(root, max_entries=10, max_bytes=100)
            (root / "escape").unlink()
            os.link(target, root / "second-link")
            with self.assertRaisesRegex(RuntimeError, "shared file inode"):
                experiment.tree_size(root, max_entries=10, max_bytes=100)

    def test_tree_size_prunes_only_validator_approved_pnpm_projects_indexes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            store = root / "store"
            (store / "v3/projects").mkdir(parents=True)
            (store / "v3/files").mkdir()
            (store / "v3/files/package").write_bytes(b"package")
            outside = root / "outside"
            outside.write_bytes(b"must not be traversed")
            (store / "v3/projects/external-link").symlink_to(outside)

            _, exclusions = experiment.input_cache.validate_offline_store(
                store, owner_uid=os.geteuid(), max_entries=100, max_bytes=100,
            )
            self.assertEqual(exclusions, frozenset({"v3/projects"}))
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                experiment.tree_size(store, max_entries=100, max_bytes=100)

            entries, size = experiment.tree_size(
                store, max_entries=100, max_bytes=100,
                excluded_relative_directories=exclusions,
            )
            self.assertEqual(entries, 4)
            self.assertEqual(size, len(b"package"))

            projects = store / "v3/projects"
            projects.chmod(0o777)
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                experiment.tree_size(
                    store, max_entries=100, max_bytes=100,
                    excluded_relative_directories=exclusions,
                )
            projects.chmod(0o755)

            (store / "v3/projects/external-link").unlink()
            with self.assertRaisesRegex(RuntimeError, "excluded index changed"):
                experiment.tree_size(store, max_entries=100, max_bytes=100,
                                    excluded_relative_directories=frozenset({"v4/projects"}))

    def test_tree_size_rejects_symlinked_excluded_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            store = root / "store"
            store.mkdir()
            target = root / "target"
            target.mkdir()
            (target / "payload").write_text("outside", encoding="ascii")
            (store / "v3").mkdir()
            (store / "v3/projects").symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "unsafe entry"):
                experiment.tree_size(
                    store, max_entries=100, max_bytes=100,
                    excluded_relative_directories=frozenset({"v3/projects"}),
                )


class ExperimentPayloadHardlinkTests(unittest.TestCase):
    def test_internal_links_are_copied_to_independent_inodes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "payload"
            (root / "web").mkdir(parents=True)
            original = root / "web/a"
            alias = root / "web/b"
            original.write_bytes(b"candidate bytes")
            os.link(original, alias)
            link = root / "web/alias"
            link.symlink_to("a")
            copied_sizes = []
            result = experiment.normalize_internal_hardlinks(
                root, max_bytes=1024, max_entries=100,
                before_copy=copied_sizes.append,
            )
            self.assertEqual(result, {
                "hardlink_groups_normalized": 1,
                "hardlink_files_copied": 1,
                "external_hardlink_groups": 0,
            })
            self.assertEqual(copied_sizes, [len(b"candidate bytes")])
            self.assertEqual(original.read_bytes(), alias.read_bytes())
            self.assertEqual(original.stat().st_nlink, 1)
            self.assertEqual(alias.stat().st_nlink, 1)
            self.assertNotEqual((original.stat().st_dev, original.stat().st_ino),
                                (alias.stat().st_dev, alias.stat().st_ino))
            self.assertEqual(os.readlink(link), "a")

    def test_external_hardlink_is_rejected_without_mutating_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "payload"
            root.mkdir()
            external = base / "outside"
            external.write_bytes(b"do not copy or mutate")
            inside = root / "outside-link"
            os.link(external, inside)
            before = (external.stat().st_dev, external.stat().st_ino,
                      external.stat().st_nlink, external.read_bytes())
            with self.assertRaises(HardlinkBoundaryError):
                experiment.normalize_internal_hardlinks(root, max_bytes=1024, max_entries=100)
            self.assertEqual((external.stat().st_dev, external.stat().st_ino,
                              external.stat().st_nlink, external.read_bytes()), before)
            self.assertEqual((inside.stat().st_dev, inside.stat().st_ino), before[:2])

    def test_external_group_fails_before_other_internal_group_is_changed(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "payload"
            root.mkdir()
            inside_a, inside_b = root / "a", root / "b"
            inside_a.write_bytes(b"internal")
            os.link(inside_a, inside_b)
            external = base / "outside"
            external.write_bytes(b"external")
            os.link(external, root / "external-link")
            inode_before = (inside_a.stat().st_dev, inside_a.stat().st_ino)
            with self.assertRaises(HardlinkBoundaryError):
                experiment.normalize_internal_hardlinks(root, max_bytes=1024, max_entries=100)
            self.assertEqual((inside_a.stat().st_dev, inside_a.stat().st_ino), inode_before)
            self.assertEqual((inside_b.stat().st_dev, inside_b.stat().st_ino), inode_before)

    def test_symlinked_directory_is_not_traversed(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "payload"
            root.mkdir()
            outside = base / "outside"
            outside.mkdir()
            sentinel = outside / "sentinel"
            sentinel.write_bytes(b"unchanged")
            (root / "alias-dir").symlink_to(outside, target_is_directory=True)
            result = experiment.normalize_internal_hardlinks(root, max_bytes=1024, max_entries=100)
            self.assertEqual(result["hardlink_files_copied"], 0)
            self.assertEqual(sentinel.read_bytes(), b"unchanged")


if __name__ == "__main__":
    unittest.main()
