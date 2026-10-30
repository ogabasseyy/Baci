#!/usr/bin/env python3
"""Linux-only regressions for copyless same-filesystem seed publication."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
sys.path[:0] = [str(TOOLS.parents[1] / "bin"), str(TOOLS)]

import dependency_seed_publisher as publisher
import dependency_seed_recovery as recovery
from dependency_seed_filesystem import freeze_tree, open_directory
from dependency_seed_test_support import fixture_generation_capability
from worker_release_dependency_policy_cache import EXPECTED_PNPM

SHA = "a" * 40
TXID = "b" * 32


@unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0,
                     "requires root-owned Linux dirfd publication")
class SameFilesystemSeedPublicationTests(unittest.TestCase):
    def fixture(self, root: Path):
        source = root / "source"
        source.mkdir(mode=0o700)
        (source / "vps-workers").mkdir()
        files = {
            ".baci-source-sha": SHA + "\n",
            "pnpm-lock.yaml": "lockVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n",
            "pnpm-workspace.yaml": "packages:\n  - apps/web\nminimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n",
            "vps-workers/pnpm-lock.yaml": "lockVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n",
            "vps-workers/pnpm-workspace.yaml": "packages:\n  - .\nminimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n",
        }
        for name, contents in files.items():
            path = source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents, encoding="ascii")
        for path in sorted(source.rglob("*"), key=lambda item: len(item.parts), reverse=True):
            path.chmod(0o555 if path.is_dir() else 0o444)
        source.chmod(0o555)
        scratch = root / "scratch"
        scratch.mkdir(mode=0o700)
        cache, store = scratch / "cache", scratch / "store"
        cache.mkdir(mode=0o700)
        store.mkdir(mode=0o700)
        (cache / "metadata.json").write_text("metadata", encoding="ascii")
        (store / "package.bin").write_bytes(b"package")
        receipt = publisher.make_receipt(source, cache, EXPECTED_PNPM,
                                         cache_max_bytes=publisher.MAX_CACHE_BYTES)
        capability = fixture_generation_capability(source, SHA, receipt)
        cache_fd = open_directory(cache, owner_uid=0)
        store_fd = open_directory(store, owner_uid=0)
        try:
            freeze_tree(cache_fd)
            freeze_tree(store_fd)
        finally:
            os.close(cache_fd)
            os.close(store_fd)
        identities = ((cache.stat().st_dev, cache.stat().st_ino),
                      (store.stat().st_dev, store.stat().st_ino))
        seeds = root / "seeds"
        seeds.mkdir(mode=0o700)
        return source, scratch, cache, store, seeds, capability, identities

    def test_published_seed_reuses_original_cache_and_store_inodes(self):
        with tempfile.TemporaryDirectory(prefix="seed-move-") as temporary:
            (source, scratch, cache, store, seeds, capability, identities) = self.fixture(Path(temporary))
            result = publisher._publish_seed(
                source, cache, store, seeds, SHA,
                generation_capability=capability, move_inputs=True, transaction_id=TXID,
            )
            self.assertEqual(result, seeds / SHA)
            self.assertFalse(cache.exists())
            self.assertFalse(store.exists())
            self.assertEqual(((result / "cache").stat().st_dev, (result / "cache").stat().st_ino), identities[0])
            self.assertEqual(((result / "store").stat().st_dev, (result / "store").stat().st_ino), identities[1])
            self.assertEqual(publisher.verify_seed(result, source, authenticated_source_sha=SHA)[
                "authenticatedSourceSha"], SHA)
            self.assertTrue(scratch.is_dir())

    def test_crash_after_first_input_rename_recovers_only_journaled_inodes(self):
        with tempfile.TemporaryDirectory(prefix="seed-move-crash-") as temporary:
            source, _scratch, cache, store, seeds, capability, identities = self.fixture(Path(temporary))
            original_move = publisher.move_input_directory
            calls = 0

            def fail_after_cache(parent_fd, destination_fd, name, expected):
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise publisher.BuilderRejected("simulated crash after cache rename")
                return original_move(parent_fd, destination_fd, name, expected)

            with patch.object(publisher, "move_input_directory", side_effect=fail_after_cache):
                with self.assertRaisesRegex(publisher.BuilderRejected, "simulated crash"):
                    publisher._publish_seed(
                        source, cache, store, seeds, SHA,
                        generation_capability=capability, move_inputs=True, transaction_id=TXID,
                    )
            self.assertFalse(cache.exists())
            self.assertTrue(store.exists())
            root_fd, lock_fd = publisher._seed_lock(seeds)
            source_fd = open_directory(source, owner_uid=0, immutable=True)
            scratch_fd = open_directory(store.parent, owner_uid=0)
            try:
                with patch.object(recovery, "publisher_is_terminal", return_value=True):
                    self.assertFalse(publisher._recover_interrupted_seed(
                        root_fd, lock_fd, source_fd, SHA,
                        max_cache_bytes=publisher.MAX_CACHE_BYTES,
                        max_store_bytes=publisher.MAX_STORE_BYTES,
                        move_source_parent_fd=scratch_fd,
                    ))
            finally:
                for fd in (scratch_fd, source_fd, lock_fd, root_fd):
                    os.close(fd)
            self.assertTrue(store.exists())
            self.assertFalse(cache.exists())
            self.assertFalse((seeds / f".{SHA}.{TXID}").exists())
            self.assertFalse((seeds / publisher.INFLIGHT_JOURNAL).exists())
            self.assertEqual((store.stat().st_dev, store.stat().st_ino), identities[1])


if __name__ == "__main__":
    unittest.main()
