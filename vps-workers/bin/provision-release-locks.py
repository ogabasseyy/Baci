#!/usr/bin/env python3
"""Provision root-owned lock files referenced by the trusted release crontab.

The production entry point is deliberately pinned to /srv/baci-workers. It
only creates lock files in that root's locks/ directory; it never follows a
symlink or accepts a caller-selected namespace.
"""
from __future__ import annotations

import os
import re
import shlex
import stat
import subprocess
import sys
import fcntl
from contextlib import contextmanager
from pathlib import Path

TRUSTED_ROOT = Path('/srv/baci-workers')
WORKER_USER = 'baci-worker'
RELEASE_USER = 'bassey'
LOCK_GROUP = 'baci-locks'
ROOT_OWNER_UID = 0
PROVISION_LOCK = Path('/run/baci-worker-release-lock-provision.lock')
LOCK_NAME = re.compile(r'^[A-Za-z0-9_.-]+\.lock$')


class ProvisionError(RuntimeError):
    """The worker lock namespace or one of its files is unsafe."""


def _cron_lock_names(crontab: str, root: Path) -> set[str]:
    """Return lock basenames passed to flock in the installed release crontab."""
    names: set[str] = set()
    lock_dir = root / 'locks'
    for line in crontab.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        try:
            tokens = shlex.split(stripped, comments=False, posix=True)
        except ValueError as exc:
            raise ProvisionError('release crontab contains malformed quoting') from exc
        for index, token in enumerate(tokens):
            if token != 'flock':
                continue
            cursor = index + 1
            while cursor < len(tokens) and tokens[cursor].startswith('-'):
                option = tokens[cursor]
                cursor += 1
                if option in ('-w', '-E', '-o', '-c'):
                    cursor += 1
            if cursor >= len(tokens):
                raise ProvisionError('release crontab has flock without a lock path')
            candidate = Path(tokens[cursor])
            if not candidate.is_absolute():
                raise ProvisionError('release crontab contains a relative flock path')
            # A same-basename lock elsewhere (notably the legacy /home path)
            # is a different inode. Refuse to map it into /srv implicitly.
            if tokens[cursor].startswith(str(lock_dir) + '/') and candidate.parent != lock_dir:
                raise ProvisionError('release crontab lock path escapes the trusted lock directory')
            if candidate.parent.name == 'locks' and candidate.parent != lock_dir:
                raise ProvisionError('legacy lock path must be migrated into the trusted release lock namespace')
            if candidate.parent == lock_dir:
                if not LOCK_NAME.fullmatch(candidate.name):
                    raise ProvisionError('release crontab contains an invalid lock filename')
                names.add(candidate.name)
    return names


def _dotenv_value(text: str, key: str) -> str | None:
    """Match the shared gigl_dotenv_value parser without evaluating shell code."""
    found: str | None = None
    have_value = False
    for original in text.splitlines():
        line = original.split('\r', 1)[0].lstrip(' \t')
        if line.startswith('export') and len(line) > 6 and line[6] in ' \t':
            line = line[7:].lstrip(' \t')
        if not line.startswith(key):
            continue
        rest = line[len(key):]
        if rest.startswith(':') and len(rest) > 1 and rest[1] in ' \t':
            value = rest[1:]
        else:
            rest = rest.lstrip(' \t')
            if not rest.startswith('='):
                continue
            value = rest[1:]

        opener_at = next((i for i, char in enumerate(value) if char not in ' \t'), None)
        opener = value[opener_at] if opener_at is not None else ''
        if opener in ('"', "'", '`'):
            closers = [i for i in range(opener_at + 1, len(value)) if value[i] == opener]
            closer = None
            for candidate in reversed(closers):
                interior_ok = all(value[i - 1] == '\\' for i in range(opener_at + 1, candidate)
                                  if value[i] == opener)
                tail = value[candidate + 1:]
                if interior_ok and re.fullmatch(r'[ \t]*(?:#.*)?', tail):
                    closer = candidate
                    break
            if closer is not None:
                result = value[opener_at + 1:closer]
                if opener == '"':
                    result = result.replace('\\n', '\n').replace('\\r', '\r')
                found, have_value = result, True
                continue

        hash_at = value.find('#')
        if hash_at >= 0:
            value = value[:hash_at]
        value = value.strip(' \t')
        maybe_double = value.startswith('"')
        if len(value) >= 2 and value[0] in ('"', "'", '`') and value[-1] == value[0]:
            value = value[1:-1]
        if maybe_double:
            value = value.replace('\\n', '\n').replace('\\r', '\r')
        found, have_value = value, True
    return found if have_value else None


def _global_lock_name(dotenv_text: str, root: Path) -> str:
    raw = _dotenv_value(dotenv_text, 'BACI_REMEDIATION_GLOBAL_LOCK_PATH')
    if raw is None or raw == '':
        return 'error-remediator-global.lock'
    supplied = Path(raw)
    resolved = supplied if supplied.is_absolute() else root / supplied
    # Require a normalized direct child. No traversal, aliases, or external
    # global lock path can expand the provisioner's authority.
    if resolved.parent != root / 'locks' or not LOCK_NAME.fullmatch(resolved.name):
        raise ProvisionError('configured global lock is outside the trusted lock namespace')
    return resolved.name


def _validate_directory(path: Path, uid: int, gid: int, mode: int) -> None:
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ProvisionError(f'{path} is not a real directory')
    if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (uid, gid, mode):
        raise ProvisionError(f'{path} ownership or mode is not trusted')


def _read_worker_environment(root: Path, *, worker_uid: int, worker_gid: int) -> str:
    """Read only the isolated runtime env after validating its fixed layout."""
    runtime = root / 'runtime'
    environment = runtime / 'worker.env'
    _validate_directory(runtime, worker_uid, worker_gid, 0o700)
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0)
    fd = os.open(environment, flags)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) !=
                (worker_uid, worker_gid, 0o600)):
            raise ProvisionError('isolated worker runtime environment has unexpected ownership or mode')
        with os.fdopen(fd, 'r', encoding='utf-8', closefd=False) as source:
            return source.read()
    finally:
        os.close(fd)


def provision_locks(root: Path, crontab: str, dotenv_text: str, *, uid: int, gid: int,
                    owner_uid: int = 0) -> list[str]:
    """Create/validate all discovered files under an already trusted root."""
    root = Path(os.path.abspath(root))
    _validate_directory(root, owner_uid, gid, 0o710)
    lock_dir = root / 'locks'
    try:
        os.mkdir(lock_dir, 0o710)
        os.chown(lock_dir, owner_uid, gid)
        os.chmod(lock_dir, 0o710)
    except FileExistsError:
        pass
    _validate_directory(lock_dir, owner_uid, gid, 0o710)
    names = _cron_lock_names(crontab, root)
    names.add(_global_lock_name(dotenv_text, root))
    for name in sorted(names):
        path = lock_dir / name
        flags = os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0)
        try:
            fd = os.open(path, flags | os.O_CREAT | os.O_EXCL, 0o660)
            try:
                os.fchown(fd, owner_uid, gid)
            except Exception:
                os.close(fd)
                raise
        except FileExistsError:
            fd = os.open(path, flags)
        try:
            info = os.fstat(fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                    info.st_uid != owner_uid or info.st_gid != gid):
                raise ProvisionError(f'{path} is not a root-owned worker lock file')
            # Repair only mode drift on an already trusted inode; ownership,
            # type, and link-count mismatches always fail closed.
            os.fchmod(fd, 0o660)
        finally:
            os.close(fd)
    return sorted(names)


@contextmanager
def _serialized_provisioning():
    """Serialize invocations using a fixed root-only lock outside worker access."""
    parent_stat = os.lstat(PROVISION_LOCK.parent)
    if (not stat.S_ISDIR(parent_stat.st_mode) or stat.S_ISLNK(parent_stat.st_mode) or
            parent_stat.st_uid != 0 or stat.S_IMODE(parent_stat.st_mode) & 0o022):
        raise ProvisionError('provision lock parent is not trusted')
    fd = os.open(PROVISION_LOCK, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1:
            raise ProvisionError('provision serialization lock is not root-only')
        os.fchmod(fd, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def main() -> int:
    if os.geteuid() != ROOT_OWNER_UID:
        print('lock provisioner must run as root', file=sys.stderr)
        return 1
    try:
        worker_uid = int(subprocess.run(['id', '-u', WORKER_USER], check=True, text=True,
                                        capture_output=True).stdout.strip())
        worker_gid = int(subprocess.run(['id', '-g', WORKER_USER], check=True, text=True,
                                        capture_output=True).stdout.strip())
        lock_gid = int(subprocess.run(['id', '-g', LOCK_GROUP], check=True, text=True,
                                      capture_output=True).stdout.strip())
        srv_stat = os.lstat(TRUSTED_ROOT.parent)
        if (not stat.S_ISDIR(srv_stat.st_mode) or stat.S_ISLNK(srv_stat.st_mode) or
                srv_stat.st_uid != ROOT_OWNER_UID or stat.S_IMODE(srv_stat.st_mode) & 0o022):
            raise ProvisionError('worker root parent is not a trusted root-owned directory')
        root_stat = os.lstat(TRUSTED_ROOT)
        if not stat.S_ISDIR(root_stat.st_mode) or stat.S_ISLNK(root_stat.st_mode):
            raise ProvisionError('fixed worker root is not a real directory')
        _validate_directory(TRUSTED_ROOT, ROOT_OWNER_UID, lock_gid, 0o710)
        with _serialized_provisioning():
            # The deployer owns the current cron schedule; baci-worker has no
            # crontab. Worker-only configuration lives in runtime/worker.env.
            cron = subprocess.run(['/usr/bin/crontab', '-u', RELEASE_USER, '-l'], check=True,
                                  text=True, capture_output=True).stdout
            env_text = _read_worker_environment(TRUSTED_ROOT, worker_uid=worker_uid,
                                                worker_gid=worker_gid)
            names = provision_locks(TRUSTED_ROOT, cron, env_text, uid=worker_uid,
                                    gid=lock_gid, owner_uid=ROOT_OWNER_UID)
        print(f'Provisioned {len(names)} trusted worker lock files.')
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError, ProvisionError) as exc:
        print(f'lock provisioner: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
