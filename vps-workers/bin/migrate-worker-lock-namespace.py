#!/usr/bin/env python3
"""One-time, root-only migration from the release home lock namespace to /srv.

Only Baci cron lines are suspended; the host cron daemon stays running. The
transaction reloads that user's crontab, drains the old lock inodes, then
installs and verifies the rewritten crontab before resuming worker units.
"""
from __future__ import annotations

import grp
import importlib.util
import os
import pwd
import stat
import subprocess
import sys
import tempfile
import time
import fcntl
from pathlib import Path
from typing import Sequence

_HELPER_SPEC = importlib.util.spec_from_file_location(
    "worker_lock_namespace_helpers", Path(__file__).with_name("worker_lock_namespace_helpers.py")
)
assert _HELPER_SPEC and _HELPER_SPEC.loader
_HELPERS = importlib.util.module_from_spec(_HELPER_SPEC)
sys.modules.setdefault(_HELPER_SPEC.name, _HELPERS)
_HELPER_SPEC.loader.exec_module(_HELPERS)
from worker_lock_namespace_helpers import (
    MigrationError, rewrite_crontab, suspend_legacy_lines, _ensure_lock_files,
    _protect_legacy_lock_files, _old_lock_inodes, _external_lock_fds,
    _external_legacy_launchers, _ensure_group_membership, _ensure_directory,
    NAME_RE, MAX_WAIT_SECONDS,
)

RELEASE_USER = 'bassey'
WORKER_USER = 'baci-worker'
LOCK_GROUP = 'baci-locks'
WORKER_ROOT = Path('/srv/baci-workers')
LEGACY_ROOT = Path('/home/bassey/baci-workers')
LEGACY_LOCKS = LEGACY_ROOT / 'locks'
LOCKS = WORKER_ROOT / 'locks'
CRON_UNIT = 'cron.service'
WORKER_UNITS = (
    'baci-gigl-tracking.timer', 'baci-cache-invalidation-drain.timer',
    'baci-domain-event-router.service', 'baci-event-delivery-worker.service',
    'baci-quiz-finalization.service', 'baci-gigl-tracking.service',
    'baci-cache-invalidation-drain.service',
)
USER_WORKER_UNITS = (
    'baci-domain-event-router.service',
    'baci-event-delivery-worker.service',
    'baci-quiz-finalization.service',
)

def _run(argv: Sequence[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(tuple(argv), check=check, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.PIPE if capture else subprocess.DEVNULL,
                          text=True, close_fds=True, cwd='/',
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'},
                          timeout=30)

def _systemctl(*args: str, check: bool = True) -> str:
    result = _run(('/usr/bin/systemctl', *args), check=check)
    if check and result.returncode != 0:
        raise MigrationError('fixed systemd operation failed')
    return (result.stdout or '').strip()

def _user_systemctl(*args: str) -> subprocess.CompletedProcess:
    uid = pwd.getpwnam(RELEASE_USER).pw_uid
    runtime = f'/run/user/{uid}'
    return _run(('/usr/sbin/runuser', '-u', RELEASE_USER, '--', '/usr/bin/env',
                 f'HOME=/home/{RELEASE_USER}', f'XDG_RUNTIME_DIR={runtime}',
                 f'DBUS_SESSION_BUS_ADDRESS=unix:path={runtime}/bus',
                 '/usr/bin/systemctl', '--user', *args), check=False)

def _assert_user_units_inactive_and_disabled() -> None:
    # Do not silently skip the user manager: that would leave possible
    # legacy holders/waiters outside the system service cgroups we drain.
    if _user_systemctl('show-environment').returncode != 0:
        raise MigrationError('cannot establish bassey user systemd manager state')
    for unit in USER_WORKER_UNITS:
        active = _user_systemctl('is-active', '--quiet', unit)
        enabled = _user_systemctl('is-enabled', '--quiet', unit)
        if active.returncode == 0 or enabled.returncode == 0:
            raise MigrationError(f'legacy bassey user worker unit must be stopped and disabled: {unit}')
        if active.returncode not in (3, 4) or enabled.returncode not in (1, 4):
            raise MigrationError(f'cannot establish bassey user unit state: {unit}')

def _read_crontab() -> str:
    result = _run(('/usr/bin/crontab', '-u', RELEASE_USER, '-l'))
    return result.stdout or ''

def _write_crontab(text: str) -> None:
    descriptor, filename = tempfile.mkstemp(prefix='baci-lock-migration-', dir='/run')
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as output:
            output.write(text)
        _run(('/usr/bin/crontab', '-u', RELEASE_USER, filename))
    finally:
        try:
            os.unlink(filename)
        except FileNotFoundError:
            pass

def _systemd_cgroup_is_empty(unit: str) -> bool:
    control_group = _systemctl('show', '--property=ControlGroup', '--value', unit)
    if not control_group:
        return True
    if not control_group.startswith('/') or '..' in Path(control_group).parts:
        raise MigrationError('systemd returned an unsafe fixed-unit cgroup path')
    population = Path('/sys/fs/cgroup') / control_group.lstrip('/') / 'cgroup.procs'
    try:
        return not population.read_text(encoding='ascii').strip()
    except FileNotFoundError:
        # systemd removes empty unit cgroups after stopping them.
        return not Path('/sys/fs/cgroup', control_group.lstrip('/')).exists()

def _reload_cron() -> None:
    # Debian cron reloads user crontabs on SIGHUP. This does not stop the
    # daemon or affect unrelated users' scheduled jobs.
    _systemctl('kill', '--signal=HUP', '--kill-who=main', CRON_UNIT)

def _assert_cron_drain(names: Sequence[str]) -> None:
    inodes = _old_lock_inodes(names)
    for name in names:
        path = LOCKS / name
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_nlink != 1:
            raise MigrationError(f'protected worker lock is not a single regular inode: {name}')
        inodes.add((info.st_dev, info.st_ino))
    deadline = time.monotonic() + MAX_WAIT_SECONDS
    while True:
        external = _external_lock_fds(inodes)
        launchers = _external_legacy_launchers(names)
        if not external and not launchers:
            return
        if time.monotonic() >= deadline:
            raise MigrationError('legacy lock descriptor or queued launcher remains during drain')
        time.sleep(0.1)

def _snapshot_unit_states() -> list[str]:
    _assert_user_units_inactive_and_disabled()
    active = []
    for unit in (CRON_UNIT, *WORKER_UNITS):
        result = _run(('/usr/bin/systemctl', 'is-active', '--quiet', unit), check=False)
        if result.returncode == 0:
            active.append(unit)
        elif result.returncode != 3:
            raise MigrationError(f'cannot establish fixed unit state: {unit}')
    if CRON_UNIT not in active:
        raise MigrationError('cron.service must be active before lock migration')
    for unit in active:
        if unit == CRON_UNIT:
            continue
        if unit.endswith('.service') and _systemctl(
                'show', '--property=KillMode', '--value', unit) != 'control-group':
            raise MigrationError(f'{unit} must use KillMode=control-group for safe drain')
    return active

def _stop_units(active: Sequence[str]) -> None:
    # Cron remains live. The user's Baci cron rows are suspended/reloaded
    # separately while unrelated host schedules continue.
    stopped: list[str] = []
    try:
        for unit in WORKER_UNITS:
            if unit in active:
                _systemctl('stop', unit)
                stopped.append(unit)
    except BaseException:
        # A partial stop must not strand a subset of the worker services.
        _start_units(stopped)
        raise

def _start_units(active: Sequence[str]) -> None:
    for unit in reversed(WORKER_UNITS):
        if unit in active:
            _systemctl('start', unit)

def migrate(*, root: Path = WORKER_ROOT, legacy_root: Path = LEGACY_ROOT,
            runner=_run, group_setup=_ensure_group_membership,
            layout_setup=None, drain_check=None) -> list[str]:
    """Transactional host migration; injectable only for isolated tests."""
    if os.geteuid() != 0:
        raise MigrationError('lock namespace migration must run as root')
    if root != WORKER_ROOT or legacy_root != LEGACY_ROOT:
        raise MigrationError('migration roots are fixed by policy')
    original = _read_crontab()
    candidate, names = rewrite_crontab(original)
    if candidate == original:
        _assert_user_units_inactive_and_disabled()
        return names
    active = _snapshot_unit_states()
    suspended = suspend_legacy_lines(original)
    if suspended == original:
        raise MigrationError('legacy lock paths were found but no suspendable crontab rows were identified')
    suspended_written = False
    candidate_written = False
    units_stopped = False
    held_old_locks: list[int] = []
    try:
        if _read_crontab() != original:
            raise MigrationError('release crontab changed before lock migration')
        _write_crontab(suspended)
        suspended_written = True
        _reload_cron()
        _stop_units(active)
        units_stopped = True
        gid = group_setup()
        if layout_setup is None:
            _ensure_directory(root, gid=gid, mode=0o710)
            _ensure_directory(root / 'locks', gid=gid, mode=0o710)
            _ensure_lock_files(names, gid=gid)
        else:
            layout_setup(root, names, gid)
        # Make the legacy namespace immutable to the release identity while
        # the old inode is drained. The directory remains traversable by the
        # shared lock group for already-running workers.
        _ensure_directory(LEGACY_LOCKS, gid=gid, mode=0o710)
        _protect_legacy_lock_files(names, gid=gid)
        inodes = _old_lock_inodes(names)
        for name in names:
            old_path = LEGACY_LOCKS / name
            if old_path.exists():
                fd = os.open(old_path, os.O_RDWR | os.O_CLOEXEC | getattr(os, 'O_NOFOLLOW', 0))
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                held_old_locks.append(fd)
        (drain_check or _assert_cron_drain)(names)
        if _read_crontab() != suspended:
            raise MigrationError('release crontab changed during lock migration')
        _write_crontab(candidate)
        candidate_written = True
        if _read_crontab() != candidate:
            raise MigrationError('rewritten release crontab did not verify')
        _reload_cron()
    except BaseException:
        if candidate_written or suspended_written:
            try:
                current = _read_crontab()
                if current in (candidate, suspended):
                    _write_crontab(original)
                    if _read_crontab() != original:
                        raise MigrationError('release crontab rollback did not verify')
                    _reload_cron()
            except BaseException as rollback_error:
                raise MigrationError('migration failed and crontab rollback failed; worker units remain stopped') from rollback_error
        for fd in held_old_locks:
            os.close(fd)
        if units_stopped:
            _start_units(active)
        raise
    finally:
        for fd in held_old_locks:
            try:
                os.close(fd)
            except OSError:
                pass
    try:
        _start_units(active)
    except BaseException as start_error:
        # The new lock namespace is committed and cron now uses it. Retry the
        # fixed worker starts once; never restore old cron paths after commit.
        try:
            _start_units(active)
        except BaseException as recovery_error:
            raise MigrationError(
                'new lock namespace committed, but worker unit recovery failed; '
                'crontab remains on protected /srv locks'
            ) from recovery_error
        raise MigrationError(
            'new lock namespace committed; worker unit start needed one recovery retry'
        ) from start_error
    return names

def main() -> int:
    try:
        names = migrate()
        print(f'Migrated {len(names)} worker lock paths to the protected /srv namespace.')
        return 0
    except (OSError, ValueError, subprocess.SubprocessError, MigrationError) as error:
        print(f'lock namespace migration failed closed: {error}', file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
