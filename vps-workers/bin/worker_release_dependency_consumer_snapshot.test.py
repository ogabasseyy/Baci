"""Mutation and replacement regressions for the disconnected source consumer."""
from __future__ import annotations

import importlib.util
import shutil
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
_path = Path(__file__).with_name("worker_release_dependency_consumer.test.py")
_spec = importlib.util.spec_from_file_location("consumer_test_fixtures", _path)
_fixtures = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = _fixtures
_spec.loader.exec_module(_fixtures)


class SnapshotMutationTests(unittest.TestCase):
    setUp = _fixtures.DependencyConsumerTests.setUp
    tearDown = _fixtures.DependencyConsumerTests.tearDown
    make_snapshot = _fixtures.DependencyConsumerTests.make_snapshot
    make_builder = _fixtures.DependencyConsumerTests.make_builder
    run_consumer = _fixtures.DependencyConsumerTests.run_consumer

    def test_result_root_replacement_during_builder_fails_closed_and_skips_cleanup(self):
        snapshot = self.make_snapshot(_fixtures.archive_bytes())
        build = self.make_builder()
        moved = self.result_root.with_name("results-original")

        def replace_result_root(source_arg, expected_sha):
            result = build(source_arg, expected_sha)
            self.result_root.rename(moved)
            self.result_root.mkdir(mode=0o700)
            return result

        try:
            with self.assertRaisesRegex(_fixtures.consumer.BuilderRejected, "result root path changed"):
                self.run_consumer(replace_result_root, snapshot=snapshot)
            self.assertTrue((moved / "candidate" / "payload").is_dir())
            self.assertEqual(list(self.result_root.iterdir()), [])
        finally:
            self.result_root.rmdir()
            moved.rename(self.result_root)

    def test_result_root_ancestor_replacement_during_builder_fails_closed(self):
        snapshot = self.make_snapshot(_fixtures.archive_bytes())
        build = self.make_builder()
        displaced = self.result_parent.with_name("build-root-original")

        def replace_ancestor(source_arg, expected_sha):
            result = build(source_arg, expected_sha)
            self.result_parent.rename(displaced)
            self.result_parent.mkdir(mode=0o700)
            self.result_root.mkdir(mode=0o700)
            return result

        try:
            with self.assertRaisesRegex(_fixtures.consumer.BuilderRejected, "result root path changed"):
                self.run_consumer(replace_ancestor, snapshot=snapshot)
            self.assertTrue((displaced / "results" / "candidate" / "payload").is_dir())
            self.assertEqual(list(self.result_root.iterdir()), [])
        finally:
            self.result_root.rmdir()
            self.result_parent.rmdir()
            displaced.rename(self.result_parent)

    def test_nonprivate_result_root_is_rejected_before_builder(self):
        self.result_root.chmod(0o750)
        called = []
        try:
            with self.assertRaisesRegex(_fixtures.consumer.BuilderRejected, "must be owner-private"):
                self.run_consumer(lambda *_args: called.append(True))
        finally:
            self.result_root.chmod(0o700)
        self.assertEqual(called, [])

    def test_source_mutation_during_builder_rejects_candidate_before_install(self):
        snapshot = self.make_snapshot(_fixtures.archive_bytes())
        build = self.make_builder()

        def mutate(source_arg, expected_sha):
            result = build(source_arg, expected_sha)
            changed = Path(source_arg) / "source.txt"
            changed.chmod(0o640)
            changed.write_text("changed while builder ran\n")
            changed.chmod(0o440)
            return result

        with self.assertRaisesRegex(_fixtures.consumer.BuilderRejected, "contents changed during build"):
            self.run_consumer(mutate, snapshot=snapshot)
        self.assertFalse((self.release / "node_modules").exists())
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())
        self.assertEqual(list(self.result_root.iterdir()), [])

    def test_snapshot_path_replacement_during_builder_rejects_identical_tree(self):
        archive = _fixtures.archive_bytes()
        snapshot = self.make_snapshot(archive)
        build = self.make_builder()

        def replace(source_arg, expected_sha):
            result = build(source_arg, expected_sha)
            source = Path(source_arg)
            replacement = source.parent / "replacement"
            displaced = source.parent / "snapshot-displaced"
            shutil.copytree(source, replacement)
            source.rename(displaced)
            replacement.rename(source)
            return result

        with self.assertRaisesRegex(_fixtures.consumer.BuilderRejected, "path changed during build"):
            self.run_consumer(replace, archive=archive, snapshot=snapshot)
        self.assertFalse((self.release / "node_modules").exists())
        self.assertEqual(list(self.result_root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
