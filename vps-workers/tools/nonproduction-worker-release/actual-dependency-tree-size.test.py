from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
