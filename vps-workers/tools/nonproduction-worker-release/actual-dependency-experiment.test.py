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


class ActualDependencyExperimentTests(unittest.TestCase):
    def test_tree_size_measures_regular_content_and_directories(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sub").mkdir()
            (root / "sub" / "payload").write_bytes(b"synthetic")
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

    def test_manual_workflow_is_read_only_and_no_secrets_are_injected(self):
        workflow = SCRIPT.parents[3] / ".github/workflows/worker-release-actual-dependency-experiment.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch", text)
        self.assertIn("contents: read", text)
        self.assertIn("persist-credentials: false", text)
        self.assertNotIn("sudo ", text)
        self.assertNotIn("secrets.", text)
        self.assertNotIn("actions/cache", text)


if __name__ == "__main__":
    unittest.main()
