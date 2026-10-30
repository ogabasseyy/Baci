from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from dependency_builder_systemd_test_seed_normalize import (
    SeedNormalizationRejected, normalize_temporary_project_index,
)


class TemporaryPnpmProjectIndexTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.store = root / "store"
        self.workspace = root / "workspace"
        (self.store / "v11/projects").mkdir(parents=True, mode=0o700)
        self.workspace.mkdir(mode=0o700)
        (self.workspace / "vps-workers").mkdir(mode=0o700)
        self.uid = os.geteuid()

    def tearDown(self):
        self.temporary.cleanup()

    def _link(self, *, name="a" * 32, target=None):
        target = self.workspace if target is None else target
        link = self.store / "v11/projects" / name
        link.symlink_to(os.path.relpath(target, link.parent), target_is_directory=True)

    def test_removes_only_hash_named_links_to_exact_fixed_importer_inodes(self):
        self._link()
        self._link(name="b" * 32, target=self.workspace / "vps-workers")

        removed = normalize_temporary_project_index(
            self.store, self.workspace, owner_uid=self.uid)

        self.assertEqual(removed, 2)
        self.assertEqual(list((self.store / "v11/projects").iterdir()), [])
        self.assertTrue(self.workspace.is_dir())

    def test_empty_or_absent_pnpm_index_fails_closed(self):
        with self.assertRaisesRegex(SeedNormalizationRejected, "missing expected"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)
        (self.store / "v11/projects").rmdir()
        (self.store / "v11").rmdir()
        with self.assertRaisesRegex(SeedNormalizationRejected, "unavailable"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)

    def test_rejects_legacy_v10_layout_when_pinned_pnpm_major_is_11(self):
        (self.store / "v11/projects").rmdir()
        (self.store / "v11").rmdir()
        legacy_projects = self.store / "v10/projects"
        legacy_projects.mkdir(parents=True, mode=0o700)
        legacy_link = legacy_projects / ("a" * 32)
        legacy_link.symlink_to(os.path.relpath(self.workspace, legacy_projects),
                               target_is_directory=True)

        with self.assertRaisesRegex(SeedNormalizationRejected, "unavailable"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)
        self.assertTrue(legacy_link.is_symlink())

    def test_refuses_link_to_another_existing_directory(self):
        other = Path(self.temporary.name) / "other"
        other.mkdir()
        sentinel = other / "keep"
        sentinel.write_text("preserve", encoding="utf-8")
        self._link(target=other)
        self._link(name="b" * 32, target=self.workspace / "vps-workers")

        with self.assertRaisesRegex(SeedNormalizationRejected, "fixed importers"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)

        self.assertTrue((self.store / "v11/projects" / ("a" * 32)).is_symlink())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve")

    def test_refuses_unexpected_index_names_or_multiple_entries(self):
        self._link(name="unexpected")
        with self.assertRaisesRegex(SeedNormalizationRejected, "fixed importer set"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)

    def test_removes_only_dangling_preverify_deploy_pointer_after_temp_root_is_gone(self):
        self._link()
        self._link(name="b" * 32, target=self.workspace / "vps-workers")
        temp_root = self.store.parent / "pnpm-policy-preverify-ab12cd34"
        link = self.store / "v11/projects" / ("c" * 32)
        link.symlink_to(os.path.relpath(temp_root / "web", link.parent))

        removed = normalize_temporary_project_index(self.store, self.workspace,
                                                    owner_uid=self.uid)

        self.assertEqual(removed, 3)
        self.assertFalse(link.exists())
        self.assertFalse(link.is_symlink())
        self.assertFalse(temp_root.exists())
        self.assertEqual(list((self.store / "v11/projects").iterdir()), [])

    def test_dangling_preverify_pointer_is_rejected_if_temp_root_still_exists(self):
        self._link()
        self._link(name="b" * 32, target=self.workspace / "vps-workers")
        temp_root = self.store.parent / "pnpm-policy-preverify-ab12cd34"
        temp_root.mkdir()
        link = self.store / "v11/projects" / ("c" * 32)
        link.symlink_to(os.path.relpath(temp_root / "web", link.parent))

        with self.assertRaisesRegex(SeedNormalizationRejected, "still present"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)
        self.assertTrue(link.is_symlink())

    def test_arbitrary_dangling_project_pointer_is_rejected_and_preserved(self):
        self._link()
        self._link(name="b" * 32, target=self.workspace / "vps-workers")
        link = self.store / "v11/projects" / ("c" * 32)
        link.symlink_to(os.path.relpath(self.store.parent / "unexpected" / "web", link.parent))

        with self.assertRaisesRegex(SeedNormalizationRejected, "target is unavailable"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)
        self.assertTrue(link.is_symlink())

    def test_refuses_non_symlink_project_index_entry(self):
        (self.store / "v11/projects" / ("b" * 32)).mkdir()
        self._link(name="c" * 32, target=self.workspace / "vps-workers")
        with self.assertRaisesRegex(SeedNormalizationRejected, "not a symlink"):
            normalize_temporary_project_index(self.store, self.workspace,
                                              owner_uid=self.uid)

    def test_seed_fixture_normalizes_after_preverification_and_before_publish(self):
        script = Path(__file__).with_name("dependency-builder-systemd-test-seed.sh")
        source = script.read_text(encoding="utf-8")
        normalize_at = source.index("normalize_temporary_project_index")
        preverify_at = source.index("--preverify --source")
        publish_at = source.index("published = _publish_seed")
        self.assertLess(preverify_at, normalize_at)
        self.assertLess(normalize_at, publish_at)
        self.assertIn("dependency_builder_systemd_test_seed_normalize.test.py", source)
        self.assertIn("dependency_builder_systemd_test_seed_normalize import", source)


if __name__ == "__main__":
    unittest.main()
