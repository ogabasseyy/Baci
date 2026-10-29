from __future__ import annotations

import importlib.util
import multiprocessing
import os
import signal
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parents[1] / "bin"))
RECOVERY_SPEC = importlib.util.spec_from_file_location(
    "dependency_seed_recovery_tests", HERE / "dependency-seed-recovery.test.py")
assert RECOVERY_SPEC and RECOVERY_SPEC.loader
recovery_tests = importlib.util.module_from_spec(RECOVERY_SPEC)
RECOVERY_SPEC.loader.exec_module(recovery_tests)
publisher = recovery_tests.publisher
import dependency_seed_tree as seed_tree


def _block_after_rename(source, cache, store, seeds, sha, receipt, ready):
    real_rename = publisher.rename_noreplace

    def block(parent_fd, stage, final):
        real_rename(parent_fd, stage, final)
        ready.set()
        time.sleep(60)

    publisher.rename_noreplace = block
    publisher.publish_seed(source, cache, store, seeds, sha, verified_receipt=receipt)


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                     "cross-SHA recovery requires Linux procfs and root-owned source")
class DependencySeedCrossShaTests(unittest.TestCase):
    def test_terminal_old_stage_is_removed_before_different_sha_publish(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_a, cache_a, store_a = recovery_tests._fixture(root / "a")
            source_b, cache_b, store_b = recovery_tests._fixture(root / "b", "b" * 40)
            seeds = root / "seeds"
            receipt = publisher.make_receipt(source_a, cache_a, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            context = multiprocessing.get_context("fork")
            ready = context.Event()
            process = context.Process(target=recovery_tests._block_in_copy,
                                      args=(source_a, cache_a, store_a, seeds, "a" * 40,
                                            receipt, ready))
            process.start()
            try:
                self.assertTrue(ready.wait(15))
                os.kill(process.pid, signal.SIGKILL)
                process.join(10)
                self.assertEqual(process.exitcode, -signal.SIGKILL)
            finally:
                if process.is_alive():
                    os.kill(process.pid, signal.SIGKILL)
                    process.join(5)
            published = recovery_tests._publish(source_b, cache_b, store_b, seeds, "b" * 40)
            self.assertTrue(published.is_dir())
            self.assertFalse((seeds / ("a" * 40)).exists())
            self.assertFalse(any(path.name.startswith(".aaaaaaaa") for path in seeds.iterdir()))
            self.assertFalse((seeds / publisher.INFLIGHT_JOURNAL).exists())

    def test_terminal_old_canonical_is_preserved_while_new_sha_publishes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_a, cache_a, store_a = recovery_tests._fixture(root / "a")
            source_b, cache_b, store_b = recovery_tests._fixture(root / "b", "b" * 40)
            seeds = root / "seeds"
            receipt = publisher.make_receipt(source_a, cache_a, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            context = multiprocessing.get_context("fork")
            ready = context.Event()
            process = context.Process(target=_block_after_rename,
                                      args=(source_a, cache_a, store_a, seeds, "a" * 40,
                                            receipt, ready))
            process.start()
            try:
                self.assertTrue(ready.wait(15))
                os.kill(process.pid, signal.SIGKILL)
                process.join(10)
                self.assertEqual(process.exitcode, -signal.SIGKILL)
            finally:
                if process.is_alive():
                    os.kill(process.pid, signal.SIGKILL)
                    process.join(5)
            old_seed = seeds / ("a" * 40)
            old_inode = (old_seed.stat().st_dev, old_seed.stat().st_ino)
            new_seed = recovery_tests._publish(source_b, cache_b, store_b, seeds, "b" * 40)
            self.assertTrue(new_seed.is_dir())
            self.assertTrue(old_seed.is_dir())
            self.assertEqual((old_seed.stat().st_dev, old_seed.stat().st_ino), old_inode)
            self.assertFalse((seeds / publisher.INFLIGHT_JOURNAL).exists())

    def test_root_quota_counts_canonical_seed_root_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = recovery_tests._fixture(root)
            seeds = root / "seeds"
            seed = recovery_tests._publish(source, cache, store, seeds, "a" * 40)
            root_fd = os.open(seeds, os.O_RDONLY | os.O_DIRECTORY)
            seed_fd = os.open(seed, os.O_RDONLY | os.O_DIRECTORY)
            cache_fd = os.open(cache, os.O_RDONLY | os.O_DIRECTORY)
            store_fd = os.open(store, os.O_RDONLY | os.O_DIRECTORY)
            try:
                measured, _ = publisher.measure_frozen_tree(
                    seed_fd, owner_uid=os.geteuid(), max_entries=100, max_bytes=1_000_000)
                counted, _ = publisher._seed_root_usage(root_fd)
                cache_count, _ = seed_tree.tree_usage_fd(
                    cache_fd, max_bytes=publisher.MAX_CACHE_BYTES, max_entries=100_000)
                store_count, _ = seed_tree.tree_usage_fd(
                    store_fd, max_bytes=publisher.MAX_STORE_BYTES, max_entries=200_000)
                budget = publisher.preflight_copy_budget(
                    root_fd, cache_fd, store_fd,
                    max_cache_bytes=publisher.MAX_CACHE_BYTES,
                    max_store_bytes=publisher.MAX_STORE_BYTES)
            finally:
                os.close(root_fd)
                os.close(seed_fd)
                os.close(cache_fd)
                os.close(store_fd)
            self.assertEqual(counted, measured + 1)
            self.assertEqual(budget["entries"], counted + 4)
            self.assertGreaterEqual(cache_count + store_count, 2)


if __name__ == "__main__":
    unittest.main()
