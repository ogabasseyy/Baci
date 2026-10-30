from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from dependency_builder_systemd_test_seed_diagnostics import ALLOWED, safe_tree_category


class SeedTreeDiagnosticTests(unittest.TestCase):
    def test_valid_tree_is_only_reported_as_valid(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "tree"
            root.mkdir(mode=0o700)
            (root / "entry").write_text("synthetic", encoding="utf-8")
            if os.geteuid() == 0:
                os.chown(root, 0, 0)
                os.chown(root / "entry", 0, 0)

            self.assertEqual(safe_tree_category(root, owner_uid=os.geteuid()), "valid")

    def test_symlink_and_hardlink_failures_have_distinct_fixed_categories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            linked = root / "linked"
            linked.mkdir(mode=0o700)
            outside = root / "outside"
            outside.write_text("opaque", encoding="utf-8")
            (linked / "entry").symlink_to(outside)
            if os.geteuid() == 0:
                os.chown(linked, 0, 0)
                os.chown(outside, 0, 0)

            self.assertEqual(safe_tree_category(linked, owner_uid=os.geteuid()), "symlink")

            linked_file_root = root / "hardlinked"
            linked_file_root.mkdir(mode=0o700)
            content = linked_file_root / "entry"
            os.link(outside, content)
            if os.geteuid() == 0:
                os.chown(linked_file_root, 0, 0)
                os.chown(content, 0, 0)
            self.assertEqual(safe_tree_category(linked_file_root, owner_uid=os.geteuid()), "hardlink")

    def test_diagnostic_output_vocabulary_is_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            category = safe_tree_category(Path(temporary) / "missing", owner_uid=os.geteuid())
            self.assertIn(category, ALLOWED)
            self.assertEqual(category, "root-unavailable")


if __name__ == "__main__":
    unittest.main()
