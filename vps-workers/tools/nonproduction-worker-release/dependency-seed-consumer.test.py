from __future__ import annotations

import os
import pwd
import sys
import tempfile
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parents[2] / "bin"
sys.path.insert(0, str(BIN))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from worker_release_dependency_seed_consumer import consume_seed
from worker_release_dependency_artifacts import BuilderRejected, copy_source_tree, make_read_only_input
from dependency_seed_publisher import EXPECTED_PNPM, make_receipt, _publish_seed
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES, validate_receipt
from dependency_seed_test_support import fixture_generation_capability

SHA_A = "a" * 40
SHA_B = "b" * 40


@unittest.skipUnless(os.geteuid() == 0 and os.path.isdir("/proc/self/fd"),
                     "seed consumption ownership contract requires Linux root")
class DependencySeedConsumerTests(unittest.TestCase):
    def _fixture(self, root: Path, sha: str = SHA_A):
        root.mkdir(parents=True, exist_ok=True)
        source = root / "source"
        (source / "vps-workers").mkdir(parents=True)
        (source / ".baci-source-sha").write_text(sha + "\n", encoding="ascii")
        (source / "pnpm-lock.yaml").write_text(
            "lockVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
        (source / "vps-workers/pnpm-lock.yaml").write_text(
            "lockVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
        (source / "pnpm-workspace.yaml").write_text(
            "packages:\n  - apps/web\nminimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
        (source / "vps-workers/pnpm-workspace.yaml").write_text(
            "packages:\n  - .\nminimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
        cache = root / "cache"
        cache.mkdir(mode=0o700)
        (cache / "metadata.json").write_text("verified registry metadata", encoding="utf-8")
        store = root / "store"
        store.mkdir(mode=0o700)
        (store / "package.bin").write_bytes(b"verified package bytes")
        for path in sorted(source.rglob("*"), key=lambda item: len(item.parts), reverse=True):
            path.chmod(0o555 if path.is_dir() else 0o444)
        source.chmod(0o555)
        seeds = root / "seeds"
        receipt = make_receipt(source, cache, EXPECTED_PNPM, cache_max_bytes=MAX_CACHE_BYTES)
        _publish_seed(source, cache, store, seeds, sha,
                     generation_capability=fixture_generation_capability(source, sha, receipt),
                     max_store_bytes=1024 * 1024)
        return source, seeds

    def _consume(self, source: Path, seeds: Path, root: Path, sha: str):
        root.mkdir(parents=True, exist_ok=True)
        uid = pwd.getpwnam("nobody").pw_uid
        gid = pwd.getpwnam("nobody").pw_gid
        source_copy = root / "input" / "source"
        source_copy.parent.mkdir(mode=0o700)
        copy_source_tree(source, source_copy, max_bytes=1024 * 1024)
        make_read_only_input(source_copy)
        scratch = root / "scratch"
        scratch.mkdir(mode=0o700)
        os.chown(scratch, uid, gid)
        input_root = source_copy.parent
        cache = consume_seed(source_copy, sha, seed_root=seeds, scratch=scratch,
                             input_root=input_root, builder_uid=uid, builder_gid=gid,
                             max_store_bytes=1024 * 1024, max_store_entries=100,
                             max_cache_bytes=MAX_CACHE_BYTES, max_cache_entries=100)
        validate_receipt(source_copy, cache, input_root / ".baci-policy-verification.json",
                         owner_uid=0, cache_owner_uid=0, expected_sha=sha)
        return cache, scratch, input_root

    def test_consumes_only_authenticated_sha_and_validates_copied_inputs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, seeds = self._fixture(root)
            cache, scratch, input_root = self._consume(source, seeds, root, SHA_A)
            self.assertEqual((scratch / "pnpm-store/package.bin").read_bytes(),
                             b"verified package bytes")
            self.assertEqual((scratch / "pnpm-cache/metadata.json").read_text(encoding="utf-8"),
                             "verified registry metadata")
            self.assertEqual((cache / "metadata.json").read_text(encoding="utf-8"),
                             "verified registry metadata")
            self.assertEqual((input_root / "pnpm-cache-receipt.json").stat().st_mode & 0o222, 0)

    def test_wrong_sha_and_missing_seed_fail_closed_without_global_fallback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_a, seeds = self._fixture(root)
            source_b, _ = self._fixture(root / "other", SHA_B)
            with self.assertRaises(BuilderRejected):
                self._consume(source_b, seeds, root / "wrong", SHA_B)
            empty_seeds = root / "empty-seeds"
            empty_seeds.mkdir(mode=0o700)
            lock = empty_seeds / ".publish.lock"
            lock.touch(mode=0o600)
            with self.assertRaisesRegex(BuilderRejected, "seed child directory is unavailable"):
                self._consume(source_a, empty_seeds, root / "missing", SHA_A)
            self.assertFalse((root / "wrong/scratch/pnpm-store").exists())
            self.assertFalse((root / "missing/scratch/pnpm-store").exists())


if __name__ == "__main__":
    unittest.main()
