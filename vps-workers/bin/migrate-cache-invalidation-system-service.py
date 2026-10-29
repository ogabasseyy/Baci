#!/usr/bin/env python3
"""Draft transactional migration of the cache HTTP scheduler from cron to systemd.

This scheduler calls the existing authenticated Next.js route. It never receives
or uses the PostgREST worker JWT. Migration is refused unless the isolated
runtime env is safe and the route's non-mutating capability preflight succeeds.
"""
from __future__ import annotations

import grp
import os
import pwd
import shutil
import stat
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Callable, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cache_scheduler_preflight import (MigrationError, _parse_runtime_env,
    _validate_layout, _verify_cache_role_preflight)
from cache_scheduler_locks import (acquire_lock as _acquire_lock,
    cache_cron_lines as _cache_cron_lines, release_lock as _release_lock,
    validate_cache_lock as _validate_cache_lock)

WORKER = "baci-worker"
LEGACY_USER = "bassey"
LEGACY_ROOT = Path("/home/bassey/baci-workers")
ROOT = Path("/srv/baci-workers")
UNIT_DIR = Path("/etc/systemd/system")
SERVICE = "baci-cache-invalidation-drain.service"
TIMER = "baci-cache-invalidation-drain.timer"
BACKUP_ROOT = Path("/var/lib/baci-workers/cache-invalidation-migration-backups")


def _run(argv: Sequence[str], *, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> str:
    try:
        result = runner(tuple(argv), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, text=True, check=False,
                        close_fds=True, cwd="/", env={"PATH": "/usr/bin:/bin", "HOME": "/root"}, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise MigrationError("cache scheduler migration command failed") from error
    if result.returncode != 0:
        raise MigrationError("cache scheduler migration command failed")
    return result.stdout or ""


def _read_crontab(*, runner=subprocess.run) -> str:
    return _run(("/usr/bin/crontab", "-u", LEGACY_USER, "-l"), runner=runner)


def _service_source() -> Path:
    return ROOT / "current/systemd" / SERVICE


def _timer_source() -> Path:
    return ROOT / "current/systemd" / TIMER


def _ensure_backup_root(backup_root: Path = BACKUP_ROOT) -> None:
    parent = backup_root.parent
    parent_parent = parent.parent
    parent_parent_info = parent_parent.lstat()
    if not stat.S_ISDIR(parent_parent_info.st_mode) or stat.S_ISLNK(parent_parent_info.st_mode) or parent_parent_info.st_uid != 0 or stat.S_IMODE(parent_parent_info.st_mode) & 0o022:
        raise MigrationError("cache migration backup parent hierarchy is unsafe")
    try:
        parent.mkdir(mode=0o755)
    except FileExistsError:
        pass
    parent_info = parent.lstat()
    if not stat.S_ISDIR(parent_info.st_mode) or stat.S_ISLNK(parent_info.st_mode) or (parent_info.st_uid, parent_info.st_gid, stat.S_IMODE(parent_info.st_mode)) != (0, 0, 0o755):
        raise MigrationError("cache migration backup parent is unsafe")
    backup_root.mkdir(mode=0o700, exist_ok=True)
    info = backup_root.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (0, 0, 0o700):
        raise MigrationError("cache migration backup directory is unsafe")


def migrate(*, runner=subprocess.run, opener=urllib.request.urlopen, root: Path = ROOT,
            unit_dir: Path = UNIT_DIR, backup_root: Path = BACKUP_ROOT, require_root: bool = True) -> Path:
    if require_root and os.geteuid() != 0:
        raise MigrationError("must run as root")
    uid, gid = _validate_layout(root)
    secret, base_url = _parse_runtime_env(root / "runtime/worker.env", worker_uid=uid, worker_gid=gid)
    _verify_cache_role_preflight(secret, base_url, opener=opener)
    if (unit_dir / SERVICE).exists() or (unit_dir / TIMER).exists():
        raise MigrationError("cache scheduler systemd unit already exists; refusing to overwrite")
    crontab = _read_crontab(runner=runner)
    matches = _cache_cron_lines(crontab, legacy_root=LEGACY_ROOT, protected_root=root)
    index, old_line, old_lock = matches[0]
    old_lock_path = Path(old_lock)
    try:
        legacy_account = pwd.getpwnam(LEGACY_USER)
    except KeyError as error:
        raise MigrationError("legacy cache scheduler account is unavailable") from error
    try:
        protected_lock_gid = grp.getgrnam("baci-locks").gr_gid
    except KeyError as error:
        raise MigrationError("protected cache lock group is unavailable") from error
    _validate_cache_lock(
        old_lock_path, legacy_root=LEGACY_ROOT, protected_root=root,
        legacy_uid=legacy_account.pw_uid, legacy_gid=legacy_account.pw_gid,
        lock_gid=protected_lock_gid,
    )
    service_source, timer_source = root / "current/systemd" / SERVICE, root / "current/systemd" / TIMER
    service_text, timer_text = service_source.read_text(), timer_source.read_text()
    if "EnvironmentFile=/srv/baci-workers/runtime/worker.env" not in service_text or "run-cache-invalidation-cron.mjs" not in service_text or "OnCalendar=*:0/2" not in timer_text:
        raise MigrationError("cache scheduler unit source does not match the reviewed contract")

    _ensure_backup_root(backup_root)
    backup = backup_root / f"cache-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}"
    backup.mkdir(mode=0o700)
    original_file = backup / "legacy.crontab"
    migrated_file = backup / "legacy.crontab.migrated"
    original_file.write_text(crontab)
    os.chmod(original_file, 0o600)
    migrated_lines = crontab.splitlines(keepends=True)
    del migrated_lines[index]
    migrated = "".join(migrated_lines)
    migrated_file.write_text(migrated)
    os.chmod(migrated_file, 0o600)
    shutil.copyfile(service_source, backup / SERVICE)
    shutil.copyfile(timer_source, backup / TIMER)
    os.chmod(backup / SERVICE, 0o600)
    os.chmod(backup / TIMER, 0o600)

    old_fd = None
    new_fd = None
    installed_service = installed_timer = cron_changed = timer_enabled = False
    try:
        _run(("/usr/bin/install", "-o", "root", "-g", "root", "-m", "0644", str(service_source), str(unit_dir / SERVICE)), runner=runner)
        installed_service = True
        _run(("/usr/bin/install", "-o", "root", "-g", "root", "-m", "0644", str(timer_source), str(unit_dir / TIMER)), runner=runner)
        installed_timer = True
        _run(("/usr/bin/systemctl", "daemon-reload"), runner=runner)
        old_fd = _acquire_lock(old_lock_path)
        _run(("/usr/bin/crontab", "-u", LEGACY_USER, str(migrated_file)), runner=runner)
        cron_changed = True
        _run(("/usr/bin/systemctl", "enable", "--now", TIMER), runner=runner)
        timer_enabled = True
    except Exception:
        if timer_enabled or installed_timer:
            try:
                _run(("/usr/bin/systemctl", "disable", "--now", TIMER), runner=runner)
                new_fd = _acquire_lock(root / "locks/cache-invalidations.lock",
                                       held_fds=(old_fd,) if old_fd is not None else ())
            except Exception:
                raise MigrationError("cache migration failed; timer could not be stopped, retaining both schedules and unit files for recovery")
        if cron_changed:
            current = _read_crontab(runner=runner)
            if current == migrated:
                _run(("/usr/bin/crontab", "-u", LEGACY_USER, str(original_file)), runner=runner)
            elif current != crontab:
                raise MigrationError("cache migration failed; operator crontab changed, preserving current state")
        if installed_timer:
            (unit_dir / TIMER).unlink(missing_ok=True)
        if installed_service:
            (unit_dir / SERVICE).unlink(missing_ok=True)
        if installed_service or installed_timer:
            _run(("/usr/bin/systemctl", "daemon-reload"), runner=runner)
        raise
    finally:
        _release_lock(new_fd)
        _release_lock(old_fd)
    return backup


def rollback(backup: Path, *, runner=subprocess.run, root: Path = ROOT, unit_dir: Path = UNIT_DIR,
             backup_root: Path = BACKUP_ROOT,
             require_root: bool = True) -> None:
    if require_root and os.geteuid() != 0:
        raise MigrationError("must run as root")
    backup = Path(backup)
    if backup.parent != backup_root or backup.is_symlink() or not backup.is_dir():
        raise MigrationError("rollback snapshot is outside the fixed cache migration backup directory")
    backup_info = backup.lstat()
    if (not stat.S_ISDIR(backup_info.st_mode) or stat.S_ISLNK(backup_info.st_mode) or
            (backup_info.st_uid, backup_info.st_gid, stat.S_IMODE(backup_info.st_mode)) != (os.geteuid(), os.getegid(), 0o700)):
        raise MigrationError("rollback snapshot ownership or mode is unsafe")
    for name in ("legacy.crontab", "legacy.crontab.migrated", SERVICE, TIMER):
        file_info = (backup / name).lstat() if (backup / name).exists() else None
        if file_info is None or not stat.S_ISREG(file_info.st_mode) or stat.S_ISLNK(file_info.st_mode) or (file_info.st_uid, file_info.st_gid, stat.S_IMODE(file_info.st_mode)) != (os.geteuid(), os.getegid(), 0o600):
            raise MigrationError("rollback snapshot is incomplete")
    if (unit_dir / SERVICE).read_bytes() != (backup / SERVICE).read_bytes() or (unit_dir / TIMER).read_bytes() != (backup / TIMER).read_bytes():
        raise MigrationError("cache systemd units changed since migration; refusing rollback")
    original = (backup / "legacy.crontab").read_text()
    migrated = (backup / "legacy.crontab.migrated").read_text()
    if _read_crontab(runner=runner) != migrated:
        raise MigrationError("legacy crontab changed since migration; refusing to overwrite operator changes")
    matches = _cache_cron_lines(original, legacy_root=LEGACY_ROOT, protected_root=root)
    old_lock = Path(matches[0][2])
    old_fd = new_fd = None
    try:
        new_fd = _acquire_lock(root / "locks/cache-invalidations.lock")
        _run(("/usr/bin/systemctl", "disable", "--now", TIMER), runner=runner)
        old_fd = _acquire_lock(old_lock, held_fds=(new_fd,) if new_fd is not None else ())
        _run(("/usr/bin/crontab", "-u", LEGACY_USER, str(backup / "legacy.crontab")), runner=runner)
        (unit_dir / TIMER).unlink()
        (unit_dir / SERVICE).unlink()
        _run(("/usr/bin/systemctl", "daemon-reload"), runner=runner)
    finally:
        _release_lock(old_fd)
        _release_lock(new_fd)


def main(argv: Sequence[str]) -> int:
    try:
        if len(argv) == 1 and argv[0] == "migrate":
            backup = migrate()
            print(f"Cache scheduler systemd migration installed. Rollback snapshot: {backup}")
            return 0
        if len(argv) == 2 and argv[0] == "rollback":
            rollback(Path(argv[1]))
            print("Cache scheduler timer stopped and exact prior cron restored.")
            return 0
        print("Usage: sudo migrate-cache-invalidation-system-service.py migrate | rollback <backup-directory>", file=sys.stderr)
        return 2
    except MigrationError as error:
        print(f"Cache scheduler migration refused: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
