#!/usr/bin/env python3
"""Protected lock namespace and same-inode scheduler cutover regressions."""
from __future__ import annotations

import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

_source = Path(__file__).with_name("migrate-cache-invalidation-system-service.test.py")
_spec = importlib.util.spec_from_file_location("cache_migration_test_fixtures", _source)
assert _spec and _spec.loader
_fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixtures)
migration = _fixtures.migration


class ProtectedCacheLockTests(unittest.TestCase):
    fixture = _fixtures.CacheSchedulerMigrationTests.fixture

    def test_parser_accepts_only_canonical_protected_cache_lock(self):
        legacy = "/home/bassey/baci-workers/locks/cache-invalidations.lock"
        protected = "/srv/baci-workers/locks/cache-invalidations.lock"
        line = (f"*/2 * * * * flock -n {protected} bash -lc 'cd /home/bassey/baci-workers && "
                "node jobs/run-cache-invalidation-cron.mjs'\n")
        self.assertEqual(migration._cache_cron_lines(
            line, legacy_root=Path("/home/bassey/baci-workers"),
            protected_root=Path("/srv/baci-workers"),
        )[0][2], protected)
        with self.assertRaisesRegex(migration.MigrationError, "outside the fixed worker lock path"):
            migration._cache_cron_lines(
                line.replace(protected, "/tmp/locks/cache-invalidations.lock"),
                legacy_root=Path("/home/bassey/baci-workers"),
                protected_root=Path("/srv/baci-workers"),
            )
        self.assertNotEqual(legacy, protected)

    def test_protected_lock_accepts_root_shared_group_mode_and_rejects_wrong_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "worker"
            lock = root / "locks/cache-invalidations.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("")
            lock.chmod(0o660)
            migration._validate_cache_lock(
                lock, legacy_root=Path(temporary) / "legacy", protected_root=root,
                legacy_uid=-1, legacy_gid=-1, lock_gid=os.getgid(), owner_uid=os.getuid(),
            )
            with self.assertRaisesRegex(migration.MigrationError, "protected cache scheduler lock"):
                migration._validate_cache_lock(
                    lock, legacy_root=Path(temporary) / "legacy", protected_root=root,
                    legacy_uid=-1, legacy_gid=-1, lock_gid=os.getgid() + 1, owner_uid=os.getuid(),
                )

    def test_protected_namespace_migrates_and_rolls_back_without_double_acquire(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, unit_dir, backup_root, state, runner = self.fixture(Path(temporary), protected_lock=True)
            lock = root / "locks/cache-invalidations.lock"
            calls = []

            def acquire(path, *, held_fds=(), **_kwargs):
                calls.append((Path(path), tuple(held_fds)))
                return None if held_fds else 55

            with patch.object(migration, "_validate_layout", return_value=(1001, 1001)), \
                 patch.object(migration, "_parse_runtime_env", return_value=("s" * 40, "https://ogabassey.com")), \
                 patch.object(migration, "_verify_cache_role_preflight"), \
                 patch.object(migration, "_ensure_backup_root"), \
                 patch.object(migration, "LEGACY_ROOT", root.parent / "legacy"), \
                 patch.object(migration.pwd, "getpwnam", return_value=SimpleNamespace(
                     pw_uid=lock.stat().st_uid, pw_gid=lock.stat().st_gid)), \
                 patch.object(migration.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=lock.stat().st_gid)), \
                 patch.object(migration, "_validate_cache_lock"), \
                 patch.object(migration, "_acquire_lock", side_effect=acquire), \
                 patch.object(migration, "_release_lock"):
                backup = migration.migrate(runner=runner, root=root, unit_dir=unit_dir,
                                           backup_root=backup_root, require_root=False)
                self.assertNotIn("run-cache-invalidation-cron.mjs", state["cron"])
                migration.rollback(backup, runner=runner, root=root, unit_dir=unit_dir,
                                   backup_root=backup_root, require_root=False)

            self.assertEqual(state["cron"].count("run-cache-invalidation-cron.mjs"), 1)
            self.assertEqual(len(calls), 3)
            self.assertTrue(all(path == lock for path, _held in calls))
            self.assertEqual(calls[0][1], ())
            self.assertEqual(calls[1][1], ())
            self.assertTrue(calls[2][1], "rollback must recognize its already-held shared inode")

    def test_acquiring_an_already_held_lock_inode_does_not_flock_twice(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cache.lock"
            path.touch(mode=0o600)
            fd = migration._acquire_lock(path, timeout=0.1)
            try:
                self.assertIsNotNone(fd)
                self.assertIsNone(migration._acquire_lock(path, held_fds=(fd,), timeout=0.1))
            finally:
                migration._release_lock(fd)

    def test_failed_timer_activation_rolls_back_with_shared_lock_held_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, unit_dir, backup_root, state, runner = self.fixture(Path(temporary), protected_lock=True)
            original_cron = state["cron"]
            state["fail_enable"] = True
            lock = root / "locks/cache-invalidations.lock"
            calls = []

            def acquire(path, *, held_fds=(), **_kwargs):
                calls.append((Path(path), tuple(held_fds)))
                return None if held_fds else 55

            with patch.object(migration, "_validate_layout", return_value=(1001, 1001)), \
                 patch.object(migration, "_parse_runtime_env", return_value=("s" * 40, "https://ogabassey.com")), \
                 patch.object(migration, "_verify_cache_role_preflight"), \
                 patch.object(migration, "_ensure_backup_root"), \
                 patch.object(migration, "LEGACY_ROOT", root.parent / "legacy"), \
                 patch.object(migration.pwd, "getpwnam", return_value=SimpleNamespace(
                     pw_uid=lock.stat().st_uid, pw_gid=lock.stat().st_gid)), \
                 patch.object(migration.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=lock.stat().st_gid)), \
                 patch.object(migration, "_validate_cache_lock"), \
                 patch.object(migration, "_acquire_lock", side_effect=acquire), \
                 patch.object(migration, "_release_lock"):
                with self.assertRaisesRegex(migration.MigrationError, "command failed"):
                    migration.migrate(runner=runner, root=root, unit_dir=unit_dir,
                                      backup_root=backup_root, require_root=False)

            self.assertEqual(state["cron"], original_cron)
            self.assertFalse((unit_dir / migration.SERVICE).exists())
            self.assertFalse((unit_dir / migration.TIMER).exists())
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0], (lock, ()))
            self.assertEqual(calls[1][0], lock)
            self.assertTrue(calls[1][1], "failed cutover must reuse the already-held protected inode")


if __name__ == "__main__":
    unittest.main()
