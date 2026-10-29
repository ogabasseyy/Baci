import importlib.util
import json
import os
import pwd
import grp
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("migrate-event-workers-to-system-services.py")
SPEC = importlib.util.spec_from_file_location("migrate_event_workers", SCRIPT)
assert SPEC and SPEC.loader
migration = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = migration
SPEC.loader.exec_module(migration)


class MigrationFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="event-unit-migration-")
        self.base = Path(self.tmp.name)
        self.root = self.base / "worker"
        (self.root / "locks").mkdir(parents=True)
        (self.root / "releases").mkdir()
        self.lock_inode_state = {}
        for lock_name in migration.LOCKS.values():
            lock_path = self.root / "locks" / lock_name
            lock_path.touch(mode=0o660)
            os.chmod(lock_path, 0o660)
            os.chown(lock_path, os.getuid(), os.getgid())
            info = lock_path.stat()
            self.lock_inode_state[lock_name] = (info.st_dev, info.st_ino, info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
        self.unit_dir = self.base / "etc/systemd/system"
        self.unit_dir.mkdir(parents=True)
        self.backup_root = self.base / "var/lib/baci-workers/event-unit-migration"
        self.unit_sources = self.base / "reviewed-units"
        self.unit_sources.mkdir()
        for service in migration.SERVICES:
            shutil.copyfile(Path(__file__).parents[1] / "systemd" / f"{service}.service",
                            self.unit_sources / f"{service}.service")
        self.paths = migration.Paths(
            root=self.root,
            unit_dir=self.unit_dir,
            backup_root=self.backup_root,
            unit_source_dir=self.unit_sources,
        )
        self.calls = []
        self.crontab = (
            "SHELL=/bin/bash\n"
            "* * * * * flock -n /srv/baci-workers/locks/process-domain-events.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd /home/bassey/baci-workers && /home/bassey/baci-workers/bin/process-domain-events.sh --once' >> /home/bassey/baci-workers/logs/process-domain-events.log 2>&1\n"
            "* * * * * flock -n /srv/baci-workers/locks/process-event-deliveries.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=event-pipeline && cd /home/bassey/baci-workers && /home/bassey/baci-workers/bin/process-event-deliveries.sh --once' >> /home/bassey/baci-workers/logs/process-event-deliveries.log 2>&1\n"
            "* * * * * flock -n /srv/baci-workers/locks/quiz-finalize.lock bash -lc 'export NODE_ENV=production && export BACI_WORKER_PROFILE=quiz-finalization && cd /home/bassey/baci-workers && timeout --signal=TERM --kill-after=5s 50s /home/bassey/baci-workers/bin/process-quiz-finalization.sh --once' >> /home/bassey/baci-workers/logs/quiz-finalize.log 2>&1\n"
            "* * * * * flock -n /srv/baci-workers/locks/quiz-finalize.lock bash -lc 'cd /home/bassey/baci-workers && /usr/bin/node /home/bassey/baci-workers/jobs/run-web-cron.mjs /api/quiz/finalize' >> /home/bassey/baci-workers/logs/quiz-route.log 2>&1\n"
            "30 9 * * * flock -n /srv/baci-workers/locks/sync-gigl-service-centres.lock bash -lc 'node jobs/sync-gigl-service-centres.mjs'\n"
        )
        self.legacy_states = {
            service: {"active": service != "baci-event-delivery-worker", "enabled": True}
            for service in migration.SERVICES
        }
        self.patches = [
            patch.object(migration.os, "geteuid", return_value=0),
            patch.object(migration, "verify_worker_layout", return_value=(710, 710)),
            patch.object(migration, "snapshot_legacy_services", return_value=self.legacy_states),
            patch.object(migration, "_legacy_systemctl", return_value=["legacy-systemctl"]),
            patch.object(migration.pwd, "getpwnam", side_effect=self._get_user),
            patch.object(migration.grp, "getgrnam", side_effect=self._get_group),
        ]
        for context in self.patches:
            context.start()

    def tearDown(self):
        for context in reversed(self.patches):
            context.stop()
        self.tmp.cleanup()

    @staticmethod
    def _get_user(name):
        if name == migration.WORKER:
            return pwd.struct_passwd(("baci-worker", "x", 710, os.getgid(), "", "/srv/baci-workers/home", "/usr/sbin/nologin"))
        if name == migration.LEGACY_USER:
            return pwd.struct_passwd(("bassey", "x", 1001, 1001, "", "/home/bassey", "/bin/bash"))
        raise KeyError(name)

    @staticmethod
    def _get_group(name):
        if name in (migration.WORKER, "baci-locks"):
            return grp.struct_group((name, "x", os.getgid(), []))
        raise KeyError(name)

    def runner(self, fail_on=None):
        def run(argv, **kwargs):
            argv = tuple(argv)
            self.calls.append(argv)
            failed = bool(fail_on and (argv == fail_on if isinstance(fail_on, tuple) else argv in fail_on))
            return subprocess.CompletedProcess(argv, 1 if failed else 0, "", "synthetic failure" if failed else "")
        return run

    def migrate(self, *, runner=None, drain_locks=None):
        return migration.migrate(paths=self.paths, runner=runner or self.runner(),
                                 verify=lambda _root: (710, os.getgid()),
                                 snapshot=lambda **_kwargs: self.legacy_states,
                                 read_crontab=lambda **_kwargs: self.crontab,
                                 write_crontab=self._write_crontab,
                                 drain_locks=drain_locks or (lambda *_args, **_kwargs: self.calls.append(("drain-worker-locks",))),
                                 root_uid=os.getuid(), root_gid=os.getgid())

    def _write_crontab(self, text, **_kwargs):
        self.calls.append(("write-crontab",))
        self.crontab = text

    def rollback(self, backup, *, runner=None, snapshot=None):
        return migration.rollback(
            backup, paths=self.paths, runner=runner or self.runner(), root_uid=os.getuid(),
            snapshot=snapshot or (lambda **_kwargs: {service: {"active": False, "enabled": False}
                                                    for service in migration.SERVICES}),
            read_crontab=lambda **_kwargs: self.crontab,
            write_crontab=self._write_crontab,
        )


__all__ = ["MigrationFixture", "migration", "os", "pwd", "grp", "shutil", "stat", "subprocess", "tempfile", "Path", "patch", "json"]
