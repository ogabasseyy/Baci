#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import shutil
import subprocess
import tempfile
import unittest
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("migrate-cache-invalidation-system-service.py")
SPEC = importlib.util.spec_from_file_location("migrate_cache_invalidation_service", SCRIPT)
assert SPEC and SPEC.loader
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


class FakeResponse:
    status = 200

    def __init__(self, body=b'{"ready":true}'):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit):
        return self.body[:limit]

    def geturl(self):
        return "https://ogabassey.com/api/cron/drain-cache-invalidations?preflight=1"


class CacheSchedulerMigrationTests(unittest.TestCase):
    def layout_fixture(self, base: Path, *, pointer: str = "releases/" + "a" * 40):
        root = base / "worker"
        worker_gid = os.getgid()
        lock_gid = os.getgid()
        worker_uid = os.getuid()
        for path, mode in (
            (root, 0o710), (root / "releases", 0o750), (root / "locks", 0o710),
            (root / "logs", 0o750), (root / "shared", 0o750), (root / "home", 0o700),
        ):
            path.mkdir(parents=True, exist_ok=True)
            path.chmod(mode)
        release = root / "releases" / ("a" * 40)
        (release / "jobs").mkdir(parents=True)
        (release / "jobs/run-cache-invalidation-cron.mjs").write_text("// fixture\n")
        release.chmod(0o550)
        (root / "current").symlink_to(pointer)
        lock = root / "locks/cache-invalidations.lock"
        lock.touch()
        lock.chmod(0o660)
        account = SimpleNamespace(pw_uid=worker_uid, pw_gid=worker_gid, pw_shell="/usr/sbin/nologin", pw_name="baci-worker")
        return root, account, worker_uid, worker_gid, lock_gid

    def test_layout_accepts_provisioned_lock_namespace_and_canonical_release_pointer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, account, uid, gid, lock_gid = self.layout_fixture(Path(temporary))
            with patch.object(migration.pwd, "getpwnam", return_value=account):
                self.assertEqual(migration._validate_layout(root, worker_uid=uid, worker_gid=gid,
                                                            lock_gid=lock_gid, owner_uid=uid), (uid, gid))

    def test_layout_rejects_legacy_bare_sha_pointer_and_unsafe_cache_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, account, uid, gid, lock_gid = self.layout_fixture(Path(temporary), pointer="a" * 40)
            with patch.object(migration.pwd, "getpwnam", return_value=account):
                with self.assertRaisesRegex(migration.MigrationError, "release pointer is unsafe"):
                    migration._validate_layout(root, worker_uid=uid, worker_gid=gid,
                                               lock_gid=lock_gid, owner_uid=uid)

            (root / "current").unlink()
            (root / "current").symlink_to(Path("releases") / ("a" * 40))
            (root / "locks/cache-invalidations.lock").chmod(0o664)
            with patch.object(migration.pwd, "getpwnam", return_value=account):
                with self.assertRaisesRegex(migration.MigrationError, "lock ownership or mode is unsafe"):
                    migration._validate_layout(root, worker_uid=uid, worker_gid=gid,
                                               lock_gid=lock_gid, owner_uid=uid)

    def test_units_are_isolated_bounded_and_keep_the_two_minute_cadence(self):
        service = (SCRIPT.parents[1] / "systemd" / migration.SERVICE).read_text()
        timer = (SCRIPT.parents[1] / "systemd" / migration.TIMER).read_text()
        self.assertIn("User=baci-worker", service)
        self.assertIn("Group=baci-worker", service)
        self.assertIn("EnvironmentFile=/srv/baci-workers/runtime/worker.env", service)
        self.assertIn("CACHE_INVALIDATION_STATE_FILE=/srv/baci-workers/shared/cache-invalidations.json", service)
        self.assertIn("flock -n /srv/baci-workers/locks/cache-invalidations.lock", service)
        self.assertIn("run-cache-invalidation-cron.mjs", service)
        self.assertIn("OnCalendar=*:0/2", timer)
        self.assertIn(f"Unit={migration.SERVICE}", timer)

    def test_preflight_requires_an_authenticated_ready_receipt_without_echoing_secret(self):
        seen = {}

        def opener(request, timeout):
            seen["url"] = request.full_url
            seen["auth"] = request.get_header("Authorization")
            seen["timeout"] = timeout
            return FakeResponse()

        secret = "x" * 40
        migration._verify_cache_role_preflight(secret, "https://ogabassey.com", opener=opener)
        self.assertEqual(seen["url"], "https://ogabassey.com/api/cron/drain-cache-invalidations?preflight=1")
        self.assertEqual(seen["auth"], f"Bearer {secret}")
        self.assertEqual(seen["timeout"], 10)
        with self.assertRaisesRegex(migration.MigrationError, "not ready"):
            migration._verify_cache_role_preflight(secret, "https://ogabassey.com", opener=lambda *_a, **_k: FakeResponse(b'{"ready":false}'))

    def test_runtime_env_requires_private_file_and_exact_https_origin(self):
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "worker.env"
            env_file.write_text(f"CRON_SECRET={'s' * 40}\nBACI_WEB_BASE_URL=https://ogabassey.com\n")
            env_file.chmod(0o600)
            uid, gid = env_file.stat().st_uid, env_file.stat().st_gid
            self.assertEqual(migration._parse_runtime_env(env_file, worker_uid=uid, worker_gid=gid), ("s" * 40, "https://ogabassey.com"))
            env_file.chmod(0o644)
            with self.assertRaisesRegex(migration.MigrationError, "ownership or mode"):
                migration._parse_runtime_env(env_file, worker_uid=uid, worker_gid=gid)

    def test_runtime_env_rejects_shell_export_that_systemd_would_not_load(self):
        with tempfile.TemporaryDirectory() as temporary:
            env_file = Path(temporary) / "worker.env"
            env_file.write_text(f"export CRON_SECRET={'s' * 40}\nBACI_WEB_BASE_URL=https://ogabassey.com\n")
            env_file.chmod(0o600)
            info = env_file.stat()
            with self.assertRaisesRegex(migration.MigrationError, "shell syntax incompatible with systemd"):
                migration._parse_runtime_env(env_file, worker_uid=info.st_uid, worker_gid=info.st_gid)
            env_file.write_text(f"CRON_SECRET={'s' * 40}\nBACI_WEB_BASE_URL=https://ogabassey.com\nexport OTHER_SETTING=value\n")
            env_file.chmod(0o600)
            with self.assertRaisesRegex(migration.MigrationError, "shell syntax incompatible with systemd"):
                migration._parse_runtime_env(env_file, worker_uid=info.st_uid, worker_gid=info.st_gid)

    def test_requires_exactly_one_canonical_legacy_schedule(self):
        lock = "/home/bassey/baci-workers/locks/cache-invalidations.lock"
        line = f"*/2 * * * * flock -n {lock} bash -lc 'cd /home/bassey/baci-workers && node jobs/run-cache-invalidation-cron.mjs'\n"
        self.assertEqual(migration._cache_cron_lines(line)[0][2], lock)
        with self.assertRaisesRegex(migration.MigrationError, "exactly one"):
            migration._cache_cron_lines(line + line)
        with self.assertRaisesRegex(migration.MigrationError, "expected two-minute"):
            migration._cache_cron_lines(line.replace("*/2", "*/5"))

    def fixture(self, base: Path):
        root = base / "worker"
        release = root / "releases" / ("a" * 40)
        unit_dir = base / "systemd"
        backup_root = base / "backups"
        state = {"cron": "SHELL=/bin/bash\n", "fail_enable": False, "commands": []}
        release.mkdir(parents=True)
        (release / "jobs").mkdir()
        (release / "systemd").mkdir()
        (release / "jobs/run-cache-invalidation-cron.mjs").write_text("// fixture\n")
        for name in (migration.SERVICE, migration.TIMER):
            source = SCRIPT.parents[1] / "systemd" / name
            shutil.copyfile(source, release / "systemd" / name)
        (root / "current").symlink_to(Path("releases") / ("a" * 40))
        old_lock = base / "legacy/locks/cache-invalidations.lock"
        old_lock.parent.mkdir(parents=True)
        old_lock.write_text("")
        state["cron"] = (
            "SHELL=/bin/bash\n"
            f"*/2 * * * * flock -n {old_lock} bash -lc 'export CACHE_INVALIDATION_STATE_FILE=/home/bassey/baci-workers/state/cache-invalidations.json && cd /home/bassey/baci-workers && /usr/bin/node /home/bassey/baci-workers/jobs/run-cache-invalidation-cron.mjs' >> /home/bassey/baci-workers/logs/cache-invalidations.log 2>&1\n"
            "15 * * * * /home/bassey/other-job.sh\n"
        )
        unit_dir.mkdir()
        backup_root.mkdir()

        def runner(argv, **_kwargs):
            argv = tuple(argv)
            state["commands"].append(argv)
            if argv[0] == "/usr/bin/crontab" and argv[-1] == "-l":
                return subprocess.CompletedProcess(argv, 0, state["cron"], "")
            if argv[0] == "/usr/bin/crontab":
                state["cron"] = Path(argv[-1]).read_text()
                return subprocess.CompletedProcess(argv, 0, "", "")
            if argv[0] == "/usr/bin/install":
                source, dest = Path(argv[-2]), Path(argv[-1])
                shutil.copyfile(source, dest)
                dest.chmod(0o644)
                return subprocess.CompletedProcess(argv, 0, "", "")
            if argv[0] == "/usr/bin/systemctl" and state["fail_enable"] and argv[1:3] == ("enable", "--now"):
                return subprocess.CompletedProcess(argv, 1, "", "failed")
            return subprocess.CompletedProcess(argv, 0, "", "")

        return root, unit_dir, backup_root, state, runner

    def test_migration_leaves_one_timer_and_rollback_restores_exact_crontab(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, unit_dir, backup_root, state, runner = self.fixture(Path(temporary))
            original_cron = state["cron"]
            def acquire_lock(path, **_kwargs):
                state["commands"].append(("acquire-lock", str(path)))
                return 55

            with patch.object(migration, "_validate_layout", return_value=(1001, 1001)), \
                 patch.object(migration, "_parse_runtime_env", return_value=("s" * 40, "https://ogabassey.com")), \
                 patch.object(migration, "_verify_cache_role_preflight"), \
                 patch.object(migration, "_ensure_backup_root"), \
                 patch.object(migration, "LEGACY_ROOT", root.parent / "legacy"), \
                 patch.object(migration.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=(root.parent / "legacy/locks/cache-invalidations.lock").stat().st_uid, pw_gid=(root.parent / "legacy/locks/cache-invalidations.lock").stat().st_gid)), \
                 patch.object(migration, "_acquire_lock", side_effect=acquire_lock), \
                 patch.object(migration, "_release_lock"):
                backup = migration.migrate(runner=runner, root=root, unit_dir=unit_dir, backup_root=backup_root, require_root=False)
                self.assertNotIn("run-cache-invalidation-cron.mjs", state["cron"])
                self.assertIn("other-job.sh", state["cron"])
                self.assertTrue((unit_dir / migration.SERVICE).is_file())
                self.assertTrue((unit_dir / migration.TIMER).is_file())
                legacy_lock = str(root.parent / "legacy/locks/cache-invalidations.lock")
                lock_index = state["commands"].index(("acquire-lock", legacy_lock))
                cron_disable_index = next(i for i, command in enumerate(state["commands"]) if command[:3] == ("/usr/bin/crontab", "-u", "bassey") and command[-1].endswith("legacy.crontab.migrated"))
                enable_index = state["commands"].index(("/usr/bin/systemctl", "enable", "--now", migration.TIMER))
                self.assertLess(lock_index, cron_disable_index)
                self.assertLess(cron_disable_index, enable_index)
                self.assertEqual(state["cron"].count("run-cache-invalidation-cron.mjs"), 0)
                migration.rollback(backup, runner=runner, root=root, unit_dir=unit_dir, backup_root=backup_root, require_root=False)
            self.assertEqual(state["cron"], original_cron)
            self.assertEqual(state["cron"].count("run-cache-invalidation-cron.mjs"), 1)
            disable_index = state["commands"].index(("/usr/bin/systemctl", "disable", "--now", migration.TIMER))
            restored_cron_index = max(i for i, command in enumerate(state["commands"]) if command[:3] == ("/usr/bin/crontab", "-u", "bassey") and command[-1].endswith("legacy.crontab"))
            self.assertLess(disable_index, restored_cron_index)
            self.assertFalse((unit_dir / migration.SERVICE).exists())
            self.assertFalse((unit_dir / migration.TIMER).exists())

    def test_failed_timer_activation_rolls_back_without_leaving_two_schedules(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, unit_dir, backup_root, state, runner = self.fixture(Path(temporary))
            original_cron = state["cron"]
            state["fail_enable"] = True
            with patch.object(migration, "_validate_layout", return_value=(1001, 1001)), \
                 patch.object(migration, "_parse_runtime_env", return_value=("s" * 40, "https://ogabassey.com")), \
                 patch.object(migration, "_verify_cache_role_preflight"), \
                 patch.object(migration, "_ensure_backup_root"), \
                 patch.object(migration, "LEGACY_ROOT", root.parent / "legacy"), \
                 patch.object(migration.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=(root.parent / "legacy/locks/cache-invalidations.lock").stat().st_uid, pw_gid=(root.parent / "legacy/locks/cache-invalidations.lock").stat().st_gid)), \
                 patch.object(migration, "_acquire_lock", return_value=55), \
                 patch.object(migration, "_release_lock"):
                with self.assertRaisesRegex(migration.MigrationError, "command failed"):
                    migration.migrate(runner=runner, root=root, unit_dir=unit_dir, backup_root=backup_root, require_root=False)
            self.assertEqual(state["cron"], original_cron)
            self.assertFalse((unit_dir / migration.SERVICE).exists())
            self.assertFalse((unit_dir / migration.TIMER).exists())

    def test_role_preflight_failure_prevents_any_schedule_or_unit_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, unit_dir, backup_root, state, runner = self.fixture(Path(temporary))
            with patch.object(migration, "_validate_layout", return_value=(1001, 1001)), \
                 patch.object(migration, "_parse_runtime_env", return_value=("s" * 40, "https://ogabassey.com")), \
                 patch.object(migration, "_verify_cache_role_preflight", side_effect=migration.MigrationError("not ready")), \
                 patch.object(migration, "LEGACY_ROOT", root.parent / "legacy"), \
                 patch.object(migration, "_ensure_backup_root"):
                with self.assertRaisesRegex(migration.MigrationError, "not ready"):
                    migration.migrate(runner=runner, root=root, unit_dir=unit_dir, backup_root=backup_root, require_root=False)
            self.assertEqual(state["cron"].count("run-cache-invalidation-cron.mjs"), 1)
            self.assertFalse((unit_dir / migration.SERVICE).exists())
            self.assertFalse((unit_dir / migration.TIMER).exists())
            self.assertEqual(state["commands"], [])


if __name__ == "__main__":
    unittest.main()
