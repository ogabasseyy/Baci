from __future__ import annotations

import importlib.util
import multiprocessing
import os
import signal
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))
sys.path.insert(0, str(Path(__file__).parent))
import dependency_seed_recovery as seed_recovery
MODULE = Path(__file__).with_name("dependency_seed_publisher.py")
SPEC = importlib.util.spec_from_file_location("dependency_seed_publisher", MODULE)
assert SPEC and SPEC.loader
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


def _fixture(root: Path, sha: str = "a" * 40):
    source = root / "source"
    (source / "vps-workers").mkdir(parents=True)
    (source / ".baci-source-sha").write_text(sha + "\n", encoding="ascii")
    for base in (source, source / "vps-workers"):
        (base / "pnpm-lock.yaml").write_text(
            "lockVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
        (base / "pnpm-workspace.yaml").write_text(
            "packages:\n  - apps/web\nminimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n",
            encoding="utf-8")
    cache = root / "cache"
    cache.mkdir(mode=0o700)
    (cache / "metadata.json").write_text("verified registry metadata", encoding="utf-8")
    store = root / "store"
    store.mkdir(mode=0o700)
    (store / "package.bin").write_bytes(b"verified package bytes")
    for path in sorted(source.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        path.chmod(0o555 if path.is_dir() else 0o444)
    source.chmod(0o555)
    return source, cache, store


def _publish(source: Path, cache: Path, store: Path, seeds: Path, sha: str):
    receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                     cache_max_bytes=publisher.MAX_CACHE_BYTES)
    return publisher.publish_seed(source, cache, store, seeds, sha,
                                  verified_receipt=receipt)


def _block_in_copy(source, cache, store, seeds, sha, receipt, ready):
    def block(*_args, **_kwargs):
        ready.set()
        time.sleep(60)

    publisher.copy_tree = block
    publisher.publish_seed(source, cache, store, seeds, sha, verified_receipt=receipt)


def _block_after_stage_mkdir(source, cache, store, seeds, sha, receipt, ready):
    def block(*_args, **_kwargs):
        ready.set()
        time.sleep(60)

    publisher.child_directory = block
    publisher.publish_seed(source, cache, store, seeds, sha, verified_receipt=receipt)


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                     "seed recovery requires Linux procfs and root-owned source fixture")
class DependencySeedRecoveryTests(unittest.TestCase):
    def test_stage_entry_cap_includes_cache_store_roots_and_manifest(self):
        expected = 100_000 + publisher.MAX_TREE_ENTRIES + 3
        self.assertEqual(seed_recovery.MAX_STAGE_ENTRIES, expected)

    def test_unresolved_prejournal_stage_is_refused_without_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            stage = seeds / ("." + "b" * 40 + "." + "c" * 32)
            stage.mkdir(parents=True, mode=0o700)
            marker = stage / "partial-file"
            marker.write_text("retain unresolved stage", encoding="ascii")
            with self.assertRaisesRegex(publisher.BuilderRejected, "unresolved seed staging"):
                _publish(source, cache, store, seeds, "a" * 40)
            self.assertEqual(marker.read_text(encoding="ascii"), "retain unresolved stage")

    @unittest.skipUnless(sys.platform == "linux", "SIGKILL journal test requires Linux fork")
    def test_sigkill_after_pinned_stage_recovers_then_publishes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            context = multiprocessing.get_context("fork")
            ready = context.Event()
            process = context.Process(target=_block_in_copy,
                                      args=(source, cache, store, seeds, "a" * 40,
                                            receipt, ready))
            process.start()
            try:
                self.assertTrue(ready.wait(15), "child did not reach post-journal copy")
                os.kill(process.pid, signal.SIGKILL)
                process.join(10)
                self.assertEqual(process.exitcode, -signal.SIGKILL)
            finally:
                if process.is_alive():
                    os.kill(process.pid, signal.SIGKILL)
                    process.join(5)
            journal = seeds / publisher.INFLIGHT_JOURNAL
            self.assertTrue(journal.is_file())
            published = _publish(source, cache, store, seeds, "a" * 40)
            self.assertTrue(published.is_dir())
            self.assertFalse(journal.exists())
            self.assertFalse(any(p.name.startswith(".aaaaaaaa") for p in seeds.iterdir()))

    def test_sigkill_between_stage_mkdir_and_open_recovers_only_empty_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            context = multiprocessing.get_context("fork")
            ready = context.Event()
            process = context.Process(target=_block_after_stage_mkdir,
                                      args=(source, cache, store, seeds, "a" * 40,
                                            receipt, ready))
            process.start()
            try:
                self.assertTrue(ready.wait(15), "child did not reach post-mkdir gap")
                os.kill(process.pid, signal.SIGKILL)
                process.join(10)
                self.assertEqual(process.exitcode, -signal.SIGKILL)
            finally:
                if process.is_alive():
                    os.kill(process.pid, signal.SIGKILL)
                    process.join(5)
            hidden = [path for path in seeds.iterdir() if path.name.startswith(".aaaaaaaa")]
            self.assertEqual(len(hidden), 1)
            self.assertEqual(list(hidden[0].iterdir()), [])
            published = _publish(source, cache, store, seeds, "a" * 40)
            self.assertTrue(published.is_dir())
            self.assertFalse((seeds / publisher.INFLIGHT_JOURNAL).exists())
            self.assertFalse(any(path.name.startswith(".aaaaaaaa") for path in seeds.iterdir()))

    def test_nonempty_unrecorded_stage_is_preserved_after_terminal_proof(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            context = multiprocessing.get_context("fork")
            ready = context.Event()
            process = context.Process(target=_block_after_stage_mkdir,
                                      args=(source, cache, store, seeds, "a" * 40,
                                            receipt, ready))
            process.start()
            try:
                self.assertTrue(ready.wait(15), "child did not reach post-mkdir gap")
                os.kill(process.pid, signal.SIGKILL)
                process.join(10)
                self.assertEqual(process.exitcode, -signal.SIGKILL)
            finally:
                if process.is_alive():
                    os.kill(process.pid, signal.SIGKILL)
                    process.join(5)
            hidden = next(path for path in seeds.iterdir() if path.name.startswith(".aaaaaaaa"))
            marker = hidden / "unexpected"
            marker.write_text("preserve", encoding="ascii")
            with self.assertRaisesRegex(publisher.BuilderRejected, "not empty"):
                _publish(source, cache, store, seeds, "a" * 40)
            self.assertEqual(marker.read_text(encoding="ascii"), "preserve")
            self.assertTrue((seeds / publisher.INFLIGHT_JOURNAL).is_file())

    def test_preflight_capacity_failure_happens_before_journal_or_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            with patch("dependency_seed_capacity.os.fstatvfs",
                       return_value=SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=0)):
                with self.assertRaisesRegex(publisher.BuilderRejected, "free capacity reserve"):
                    _publish(source, cache, store, seeds, "a" * 40)
            self.assertEqual([path.name for path in seeds.iterdir()], [".publish.lock"])

    def test_live_capacity_drop_aborts_bounded_copy_and_cleans_private_stage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            (cache / "large.bin").write_bytes(b"x" * (2 * 1024 * 1024))
            seeds = root / "seeds"
            real_fstatvfs = os.fstatvfs
            calls = 0

            def capacity(fd):
                nonlocal calls
                calls += 1
                if calls <= 3:
                    return real_fstatvfs(fd)
                return SimpleNamespace(f_bavail=0, f_frsize=4096, f_favail=10_000)

            with patch("dependency_seed_capacity.os.fstatvfs", side_effect=capacity):
                with self.assertRaisesRegex(publisher.BuilderRejected, "free capacity reserve"):
                    _publish(source, cache, store, seeds, "a" * 40)
            self.assertGreaterEqual(calls, 4)
            self.assertEqual([path.name for path in seeds.iterdir()], [".publish.lock"])

    def test_source_change_during_copy_prevents_publication_and_clears_owned_journal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            real_copy = publisher.copy_tree
            calls = 0

            def mutate_after_copy(source_fd, parent_fd, destination, **kwargs):
                nonlocal calls
                copied_fd = real_copy(source_fd, parent_fd, destination, **kwargs)
                calls += 1
                if calls == 1:
                    lockfile = source / "pnpm-lock.yaml"
                    lockfile.write_text(lockfile.read_text(encoding="utf-8") + "# changed\n",
                                        encoding="utf-8")
                return copied_fd

            with patch.object(publisher, "copy_tree", side_effect=mutate_after_copy):
                with self.assertRaisesRegex(publisher.BuilderRejected, "source tree changed"):
                    _publish(source, cache, store, seeds, "a" * 40)
            self.assertFalse((seeds / ("a" * 40)).exists())
            self.assertFalse((seeds / publisher.INFLIGHT_JOURNAL).exists())
            self.assertEqual([p.name for p in seeds.iterdir()], [".publish.lock"])

    def test_source_change_at_rename_leaves_canonical_seed_fenced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            real_rename = publisher.rename_noreplace

            def mutate_then_rename(parent_fd, staging_name, sha):
                lockfile = source / "pnpm-lock.yaml"
                lockfile.write_text(lockfile.read_text(encoding="utf-8") + "# late change\n",
                                    encoding="utf-8")
                real_rename(parent_fd, staging_name, sha)

            with patch.object(publisher, "rename_noreplace", side_effect=mutate_then_rename):
                with self.assertRaisesRegex(publisher.BuilderRejected, "changed during seed publication"):
                    _publish(source, cache, store, seeds, "a" * 40)
            canonical = seeds / ("a" * 40)
            self.assertTrue(canonical.is_dir())
            self.assertTrue((seeds / publisher.INFLIGHT_JOURNAL).is_file())
            with self.assertRaisesRegex(publisher.BuilderRejected, "unresolved seed journal"):
                publisher.verify_seed(canonical, source, authenticated_source_sha="a" * 40)

    def test_aggregate_quota_preserves_existing_seeds_and_refuses_new_one(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = _fixture(root)
            seeds = root / "seeds"
            first = _publish(source, cache, store, seeds, "a" * 40)
            source_b = root / "source-b"
            shutil.copytree(source, source_b)
            (source_b / ".baci-source-sha").write_text("b" * 40 + "\n", encoding="ascii")
            root_fd = os.open(seeds, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                entries, used = publisher._seed_root_usage(root_fd)
            finally:
                os.close(root_fd)
            self.assertGreater(entries, 0)
            with patch.object(publisher, "MAX_SEED_ROOT_BYTES", used):
                with self.assertRaisesRegex(publisher.BuilderRejected, "aggregate quota"):
                    _publish(source_b, cache, store, seeds, "b" * 40)
            self.assertTrue(first.is_dir())
            self.assertFalse((seeds / ("b" * 40)).exists())
            self.assertFalse((seeds / publisher.INFLIGHT_JOURNAL).exists())


if __name__ == "__main__":
    unittest.main()
