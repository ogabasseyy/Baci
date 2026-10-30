from __future__ import annotations

import concurrent.futures
import fcntl
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))
from worker_release_dependency_policy_cache import _hash_tree
from dependency_seed_test_support import fixture_generation_capability
MODULE = Path(__file__).with_name("dependency_seed_publisher.py")
SPEC = importlib.util.spec_from_file_location("dependency_seed_publisher", MODULE)
assert SPEC and SPEC.loader
publisher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(publisher)


@unittest.skipUnless(os.path.isdir("/proc/self/fd") and os.geteuid() == 0,
                     "publication requires Linux procfs and root-owned source fixture")
class DependencySeedPublisherTests(unittest.TestCase):
    def fixture(self, root: Path, sha: str = "a" * 40):
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
        return source, cache, store

    def publish(self, source: Path, cache: Path, store: Path, seeds: Path, sha: str):
        receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                         cache_max_bytes=publisher.MAX_CACHE_BYTES)
        return publisher._publish_seed(source, cache, store, seeds, sha,
                                      generation_capability=fixture_generation_capability(
                                          source, sha, receipt))

    def test_publish_is_sha_scoped_frozen_and_verified(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            published = self.publish(source, cache, store, seeds, "a" * 40)
            self.assertEqual(published, seeds / ("a" * 40))
            self.assertEqual(published.stat().st_mode & 0o222, 0)
            manifest = publisher.verify_seed(published, source, authenticated_source_sha="a" * 40)
            self.assertEqual(manifest["authenticatedSourceSha"], "a" * 40)
            self.assertEqual((published / "cache/metadata.json").stat().st_mode & 0o222, 0)
            self.assertEqual((published / "store/package.bin").stat().st_mode & 0o222, 0)

    def test_consumer_rejects_durable_attestation_tampering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            published = self.publish(source, cache, store, root / "seeds", "a" * 40)
            manifest_path = published / publisher.MANIFEST
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["generationAttestation"]["fence"]["sha"] = "b" * 40
            os.chmod(manifest_path, 0o644)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            os.chmod(manifest_path, 0o444)
            with self.assertRaisesRegex(publisher.BuilderRejected,
                                        "fence does not match authenticated source"):
                publisher.verify_seed(published, source, authenticated_source_sha="a" * 40)

    def test_existing_sha_is_reused_only_after_verification_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            published = self.publish(source, cache, store, seeds, "a" * 40)
            before = (published / "store/package.bin").read_bytes()
            (store / "package.bin").write_bytes(b"different bytes")
            callback_calls = []
            receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            capability = fixture_generation_capability(
                source, "a" * 40, receipt,
                prepublish_guard=lambda: callback_calls.append("revalidated"))
            reused = publisher._publish_seed(
                source, cache, store, seeds, "a" * 40,
                generation_capability=capability)
            self.assertEqual(reused, published)
            self.assertEqual(callback_calls, ["revalidated"])
            self.assertEqual((published / "store/package.bin").read_bytes(), before)

    def test_recovery_shortcut_revalidates_fence_before_success_return(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            seeds.mkdir(mode=0o700)
            (seeds / publisher.INFLIGHT_JOURNAL).write_text("synthetic", encoding="ascii")
            receipt = publisher.make_receipt(source, cache, publisher.EXPECTED_PNPM,
                                             cache_max_bytes=publisher.MAX_CACHE_BYTES)
            callback_calls = []

            def reject_fence():
                callback_calls.append(True)
                raise publisher.BuilderRejected("authenticated run fence changed")

            capability = fixture_generation_capability(
                source, "a" * 40, receipt, prepublish_guard=reject_fence)
            with patch.object(publisher, "_recover_interrupted_seed", return_value=True):
                with self.assertRaisesRegex(publisher.BuilderRejected, "fence changed"):
                    publisher._publish_seed(
                        source, cache, store, seeds, "a" * 40,
                        generation_capability=capability)
            self.assertEqual(callback_calls, [True])

    def test_separate_authenticated_shas_publish_independently(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_a, cache, store = self.fixture(root, "a" * 40)
            seeds = root / "seeds"
            self.publish(source_a, cache, store, seeds, "a" * 40)
            source_b = root / "source-b"
            source_b.mkdir()
            for name in (".baci-source-sha", "pnpm-lock.yaml", "pnpm-workspace.yaml"):
                (source_b / name).write_bytes((source_a / name).read_bytes())
            (source_b / ".baci-source-sha").write_text("b" * 40 + "\n", encoding="ascii")
            (source_b / "vps-workers").mkdir()
            for name in ("pnpm-lock.yaml", "pnpm-workspace.yaml"):
                (source_b / "vps-workers" / name).write_bytes((source_a / "vps-workers" / name).read_bytes())
            for path in sorted(source_b.rglob("*"), key=lambda item: len(item.parts), reverse=True):
                path.chmod(0o555 if path.is_dir() else 0o444)
            source_b.chmod(0o555)
            result = self.publish(source_b, cache, store, seeds, "b" * 40)
            self.assertEqual(result.name, "b" * 40)
            self.assertTrue((seeds / ("a" * 40)).is_dir())

    def test_collision_and_input_sha_mismatch_fail_without_final_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            with self.assertRaisesRegex(publisher.BuilderRejected, "does not match"):
                self.publish(source, cache, store, seeds, "b" * 40)
            self.assertFalse((seeds / ("b" * 40)).exists())
            collision = seeds / ("a" * 40)
            collision.mkdir(parents=True, mode=0o555)
            sentinel = collision / "sentinel"
            sentinel.write_text("do not replace", encoding="ascii")
            sentinel.chmod(0o444)
            collision.chmod(0o555)
            with self.assertRaisesRegex(publisher.BuilderRejected, "manifest is unavailable"):
                self.publish(source, cache, store, seeds, "a" * 40)
            self.assertEqual(sentinel.read_text(encoding="ascii"), "do not replace")

    def test_prepublication_fence_guard_runs_after_copy_and_can_block_final_rename(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            receipt = publisher.make_receipt(
                source, cache, publisher.EXPECTED_PNPM,
                cache_max_bytes=publisher.MAX_CACHE_BYTES)
            observed = []

            def guard():
                observed.append(sorted(path.name for path in seeds.iterdir()))
                raise publisher.BuilderRejected("authenticated run fence changed")

            with self.assertRaisesRegex(publisher.BuilderRejected, "fence changed"):
                publisher._publish_seed(
                    source, cache, store, seeds, "a" * 40,
                    generation_capability=fixture_generation_capability(
                        source, "a" * 40, receipt, prepublish_guard=guard))
            self.assertEqual(len(observed), 1)
            # Staging is complete, but the final SHA name is never published.
            self.assertTrue(any(name.startswith("." + "a" * 40 + ".")
                                for name in observed[0]))
            self.assertFalse((seeds / ("a" * 40)).exists())

    def test_writable_source_entry_is_rejected_before_seed_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            (source / "vps-workers").chmod(0o755)
            seeds = root / "seeds"
            with self.assertRaisesRegex(publisher.BuilderRejected, "source entry is writable"):
                self.publish(source, cache, store, seeds, "a" * 40)
            self.assertFalse(seeds.exists())

    def test_copy_failure_cleans_only_private_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            real_copy = publisher.copy_tree
            calls = 0

            def fail_after_partial(src, parent_fd, destination, **kwargs):
                nonlocal calls
                calls += 1
                copied_fd = real_copy(src, parent_fd, destination, **kwargs)
                if calls == 2:
                    os.close(copied_fd)
                    raise OSError("injected copy failure")
                return copied_fd

            with patch.object(publisher, "copy_tree", side_effect=fail_after_partial):
                with self.assertRaises(OSError):
                    self.publish(source, cache, store, seeds, "a" * 40)
            self.assertFalse((seeds / ("a" * 40)).exists())
            self.assertEqual([p.name for p in seeds.iterdir()], [".publish.lock"])

    def test_copy_digest_mismatches_report_only_the_affected_seed_input(self):
        for mismatch, expected_error in (
                ("cache", "seed policy cache changed while copying"),
                ("store", "seed package store changed while copying")):
            with self.subTest(mismatch=mismatch), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source, cache, store = self.fixture(root)
                seeds = root / "seeds"
                real_cache_digest = publisher.policy_cache_digest_fd
                real_store_digest = publisher.tree_digest_fd
                cache_calls = 0
                store_calls = 0

                def cache_digest(fd, *, max_bytes):
                    nonlocal cache_calls
                    cache_calls += 1
                    if mismatch == "cache" and cache_calls == 2:
                        return "f" * 64
                    return real_cache_digest(fd, max_bytes=max_bytes)

                def store_digest(fd, *, max_bytes):
                    nonlocal store_calls
                    store_calls += 1
                    if mismatch == "store" and store_calls == 2:
                        return "f" * 64
                    return real_store_digest(fd, max_bytes=max_bytes)

                with patch.object(publisher, "policy_cache_digest_fd", side_effect=cache_digest), \
                     patch.object(publisher, "tree_digest_fd", side_effect=store_digest):
                    with self.assertRaisesRegex(publisher.BuilderRejected, expected_error):
                        self.publish(source, cache, store, seeds, "a" * 40)
                self.assertEqual(cache_calls, 2)
                self.assertEqual(store_calls, 2 if mismatch == "store" else 1)
                self.assertFalse((seeds / ("a" * 40)).exists())

    def test_concurrent_same_sha_publication_is_verified_and_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(
                    lambda _: self.publish(source, cache, store, seeds, "a" * 40), range(2)))
            self.assertEqual(results, [seeds / ("a" * 40)] * 2)
            self.assertEqual(publisher.verify_seed(seeds / ("a" * 40), source,
                                                   authenticated_source_sha="a" * 40)["schema"], 2)
            self.assertEqual(sorted(p.name for p in seeds.iterdir()), [".publish.lock", "a" * 40])

    def test_writable_child_is_rejected_before_hash_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            published = self.publish(source, cache, store, root / "seeds", "a" * 40)
            file = published / "cache/metadata.json"
            file.chmod(0o644)
            with self.assertRaisesRegex(publisher.BuilderRejected, "writable or foreign-owned"):
                publisher.verify_seed(published, source, authenticated_source_sha="a" * 40)

    def test_post_publish_cache_or_store_tamper_is_detected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            published = self.publish(source, cache, store, root / "seeds", "a" * 40)
            file = published / "store/package.bin"
            file.chmod(0o600)
            file.write_bytes(b"tampered")
            file.chmod(0o444)
            with self.assertRaisesRegex(publisher.BuilderRejected, "changed"):
                publisher.verify_seed(published, source, authenticated_source_sha="a" * 40)

    def test_noreplace_closes_check_to_rename_race(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            real_publish = publisher.rename_noreplace

            def inject_target(parent_fd, stage, final):
                os.mkdir(final, 0o700, dir_fd=parent_fd)
                target_fd = os.open(final, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                                    dir_fd=parent_fd)
                try:
                    sentinel = os.open("sentinel", os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                                       0o600, dir_fd=target_fd)
                    os.write(sentinel, b"concurrent target")
                    os.close(sentinel)
                finally:
                    os.close(target_fd)
                real_publish(parent_fd, stage, final)

            with patch.object(publisher, "rename_noreplace", side_effect=inject_target):
                with self.assertRaisesRegex(publisher.BuilderRejected, "already exists"):
                    self.publish(source, cache, store, seeds, "a" * 40)
            self.assertEqual((seeds / ("a" * 40) / "sentinel").read_bytes(), b"concurrent target")

    def test_seed_root_path_swap_never_redirects_descriptor_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            seeds.mkdir(mode=0o700)
            moved = root / "pinned-seeds"
            attacker = root / "attacker-directory"
            attacker.mkdir(mode=0o700)
            original_copy = publisher.copy_tree
            swapped = False

            def swap_name_after_lock(source_fd, parent_fd, destination, **kwargs):
                nonlocal swapped
                if not swapped:
                    seeds.rename(moved)
                    seeds.symlink_to(attacker, target_is_directory=True)
                    swapped = True
                return original_copy(source_fd, parent_fd, destination, **kwargs)

            with patch.object(publisher, "copy_tree", side_effect=swap_name_after_lock):
                with self.assertRaisesRegex(publisher.BuilderRejected, "root path changed"):
                    self.publish(source, cache, store, seeds, "a" * 40)
            self.assertFalse((moved / ("a" * 40)).exists())
            self.assertEqual([entry.name for entry in moved.iterdir()], [".publish.lock"])
            self.assertFalse((attacker / ("a" * 40)).exists())

    def test_freeze_revalidates_exact_staged_tree_before_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, cache, store = self.fixture(root)
            seeds = root / "seeds"
            real_freeze = publisher.freeze_tree

            def freeze_then_add(fd):
                real_freeze(fd)
                os.chmod(f"/proc/self/fd/{fd}/store", 0o755)
                (Path(f"/proc/self/fd/{fd}/store") / "late-entry").write_text("late")

            with patch.object(publisher, "freeze_tree", side_effect=freeze_then_add):
                with self.assertRaisesRegex(publisher.BuilderRejected, "writable or foreign-owned"):
                    self.publish(source, cache, store, seeds, "a" * 40)
            self.assertFalse((seeds / ("a" * 40)).exists())
            self.assertEqual([entry.name for entry in seeds.iterdir()], [".publish.lock"])

    def test_replaced_publish_lock_path_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "seeds"
            root.mkdir(mode=0o700)
            real_flock = fcntl.flock

            def replace_lock(fd, operation):
                real_flock(fd, operation)
                if operation == fcntl.LOCK_EX:
                    (root / ".publish.lock").unlink()
                    (root / ".publish.lock").write_text("replacement")
                    (root / ".publish.lock").chmod(0o600)

            with patch.object(fcntl, "flock", side_effect=replace_lock):
                with self.assertRaisesRegex(publisher.BuilderRejected, "lock name changed"):
                    publisher._seed_lock(root)

if __name__ == "__main__":
    unittest.main()
