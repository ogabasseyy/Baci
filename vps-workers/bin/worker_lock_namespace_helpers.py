"""Lock migration parsing and inode helpers."""
from __future__ import annotations
import os
import re
import shlex
import grp
import pwd
import stat
import subprocess
from pathlib import Path
from typing import Sequence

WORKER_ROOT = Path('/srv/baci-workers')
LEGACY_ROOT = Path('/home/bassey/baci-workers')
LEGACY_LOCKS = LEGACY_ROOT / 'locks'
LOCKS = WORKER_ROOT / 'locks'
RELEASE_USER = 'bassey'
WORKER_USER = 'baci-worker'
LOCK_GROUP = 'baci-locks'
NAME_RE = re.compile(r'^[A-Za-z0-9_.-]+\.lock$')
MAX_WAIT_SECONDS = 30
class MigrationError(RuntimeError):
    pass

def _run(argv: Sequence[str]) -> subprocess.CompletedProcess:
    return subprocess.run(tuple(argv), check=True, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                          close_fds=True, cwd='/',
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root'},
                          timeout=30)


def rewrite_crontab(text: str, *, legacy_locks: Path = LEGACY_LOCKS,
                    protected_locks: Path = LOCKS) -> tuple[str, list[str]]:
    """Rewrite only exact flock lock operands; preserve all other cron bytes."""
    rewritten: list[str] = []
    names: set[str] = set()
    for line in text.splitlines(keepends=True):
        if not line.strip() or line.lstrip().startswith('#'):
            rewritten.append(line)
            continue
        try:
            tokens = shlex.split(line, comments=False, posix=True)
        except ValueError as error:
            raise MigrationError('release crontab has malformed shell quoting') from error
        replacements: list[tuple[str, str]] = []
        for index, token in enumerate(tokens):
            if token != 'flock':
                continue
            cursor = index + 1
            while cursor < len(tokens) and tokens[cursor].startswith('-'):
                option = tokens[cursor]
                cursor += 1
                if option in ('-w', '-E'):
                    cursor += 1
            if cursor >= len(tokens):
                raise MigrationError('release crontab has flock without a path')
            operand = tokens[cursor]
            candidate = Path(operand)
            if not candidate.is_absolute():
                if 'locks/' in operand:
                    raise MigrationError('relative worker lock operand cannot be migrated safely')
                continue
            if candidate.parent == legacy_locks:
                if not NAME_RE.fullmatch(candidate.name):
                    raise MigrationError('legacy worker lock filename is invalid')
                old = str(candidate)
                new = str(protected_locks / candidate.name)
                replacements.append((old, new))
                names.add(candidate.name)
            elif candidate.parent == protected_locks:
                if not NAME_RE.fullmatch(candidate.name):
                    raise MigrationError('protected worker lock filename is invalid')
                names.add(candidate.name)
            elif candidate.parent.name == 'locks':
                raise MigrationError('worker lock path is outside both fixed namespaces')
        updated = line
        for old, new in replacements:
            updated = updated.replace(old, new)
        rewritten.append(updated)
    return ''.join(rewritten), sorted(names)

def suspend_legacy_lines(text: str, *, legacy_locks: Path = LEGACY_LOCKS) -> str:
    """Comment only active crontab rows that reference the legacy lock tree."""
    output = []
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped and not stripped.startswith('#'):
            try:
                tokens = shlex.split(line, comments=False, posix=True)
            except ValueError as error:
                raise MigrationError('release crontab has malformed shell quoting') from error
            legacy_operand = False
            for index, token in enumerate(tokens):
                if token != 'flock':
                    continue
                cursor = index + 1
                while cursor < len(tokens) and tokens[cursor].startswith('-'):
                    option = tokens[cursor]
                    cursor += 1
                    if option in ('-w', '-E'):
                        cursor += 1
                if cursor < len(tokens) and Path(tokens[cursor]).parent == legacy_locks:
                    legacy_operand = True
                    break
            if legacy_operand:
                indent = line[:len(line) - len(stripped)]
                output.append(f'{indent}# baci-lock-migration: {line[len(indent):]}')
                continue
        output.append(line)
    return ''.join(output)

def _ensure_lock_files(names: Sequence[str], *, gid: int) -> None:
    for name in names:
        if not NAME_RE.fullmatch(name):
            raise MigrationError('invalid worker lock name')
        path = LOCKS / name
        flags = os.O_RDWR | os.O_CREAT | os.O_CLOEXEC | getattr(os, 'O_NOFOLLOW', 0)
        descriptor = os.open(path, flags, 0o660)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise MigrationError(f'worker lock is not a single regular inode: {name}')
            os.fchown(descriptor, 0, gid)
            os.fchmod(descriptor, 0o660)
            final = os.fstat(descriptor)
            if (final.st_uid, final.st_gid, stat.S_IMODE(final.st_mode)) != (0, gid, 0o660):
                raise MigrationError(f'worker lock ownership did not apply: {name}')
        finally:
            os.close(descriptor)

def _protect_legacy_lock_files(names: Sequence[str], *, gid: int) -> None:
    """Harden old lock inodes in place; never unlink/recreate a flock file."""
    for name in names:
        if not NAME_RE.fullmatch(name):
            raise MigrationError('invalid legacy worker lock name')
        path = LEGACY_LOCKS / name
        try:
            before = os.lstat(path)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(before.st_mode) or stat.S_ISLNK(before.st_mode) or before.st_nlink != 1:
            raise MigrationError(f'legacy worker lock is not a single regular inode: {name}')
        descriptor = os.open(path, os.O_RDWR | os.O_CLOEXEC | getattr(os, 'O_NOFOLLOW', 0))
        try:
            opened = os.fstat(descriptor)
            if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                raise MigrationError(f'legacy worker lock changed while opening: {name}')
            os.fchown(descriptor, 0, gid)
            os.fchmod(descriptor, 0o660)
            final = os.fstat(descriptor)
            if (final.st_uid, final.st_gid, stat.S_IMODE(final.st_mode)) != (0, gid, 0o660):
                raise MigrationError(f'legacy worker lock could not be hardened: {name}')
        finally:
            os.close(descriptor)

def _old_lock_inodes(names: Sequence[str]) -> set[tuple[int, int]]:
    result = set()
    for name in names:
        path = LEGACY_LOCKS / name
        try:
            info = os.lstat(path)
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_nlink != 1:
            raise MigrationError(f'legacy lock is not a single regular inode: {name}')
        result.add((info.st_dev, info.st_ino))
    return result

def _external_lock_fds(inodes: set[tuple[int, int]]) -> list[str]:
    """Find any process still holding or waiting on an old lock pathname."""
    matches: list[str] = []
    own_pid = os.getpid()
    try:
        processes = os.listdir('/proc')
    except OSError as error:
        raise MigrationError('cannot enumerate process descriptors during lock drain') from error
    for pid_text in processes:
        if not pid_text.isdigit() or int(pid_text) == own_pid:
            continue
        fd_dir = Path('/proc') / pid_text / 'fd'
        try:
            fd_names = os.listdir(fd_dir)
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError as error:
            raise MigrationError('cannot inspect process descriptors during lock drain') from error
        for fd_name in fd_names:
            try:
                info = os.stat(fd_dir / fd_name)
            except (FileNotFoundError, ProcessLookupError):
                continue
            except PermissionError as error:
                raise MigrationError('cannot inspect process descriptor during lock drain') from error
            if (info.st_dev, info.st_ino) in inodes:
                matches.append(f'{pid_text}:{fd_name}')
                break
    return matches

def _external_legacy_launchers(names: Sequence[str]) -> list[str]:
    """Detect an out-of-cgroup process already queued with a legacy operand."""
    needles = [os.fsencode(str(LEGACY_LOCKS / name)) for name in names]
    found: list[str] = []
    own_pid = os.getpid()
    try:
        pids = os.listdir('/proc')
    except OSError as error:
        raise MigrationError('cannot enumerate processes during lock migration') from error
    for pid_text in pids:
        if not pid_text.isdigit() or int(pid_text) == own_pid:
            continue
        base = Path('/proc') / pid_text
        for entry in ('cmdline', 'environ'):
            try:
                content = (base / entry).read_bytes()
            except (FileNotFoundError, ProcessLookupError):
                break
            except PermissionError as error:
                raise MigrationError('cannot inspect process launch state during lock migration') from error
            if any(needle in content for needle in needles):
                found.append(f'{pid_text}:{entry}')
                break
    return found

def _ensure_group_membership() -> int:
    users = {}
    for username in (RELEASE_USER, WORKER_USER):
        try:
            users[username] = pwd.getpwnam(username)
        except KeyError as error:
            raise MigrationError('required lock group account is unavailable') from error
    try:
        group = grp.getgrnam(LOCK_GROUP)
    except KeyError:
        _run(('/usr/sbin/groupadd', '--system', LOCK_GROUP))
        group = grp.getgrnam(LOCK_GROUP)
    unexpected = set(group.gr_mem) - {RELEASE_USER, WORKER_USER}
    if unexpected:
        raise MigrationError('shared lock group has an unexpected member')
    for username in (RELEASE_USER, WORKER_USER):
        user = users[username]
        if group.gr_gid not in os.getgrouplist(username, user.pw_gid):
            _run(('/usr/sbin/usermod', '-a', '-G', LOCK_GROUP, username))
    group = grp.getgrnam(LOCK_GROUP)
    unexpected = set(group.gr_mem) - {RELEASE_USER, WORKER_USER}
    if unexpected:
        raise MigrationError('shared lock group has an unexpected member')
    if not {RELEASE_USER, WORKER_USER}.issubset(set(group.gr_mem)):
        raise MigrationError('shared lock group membership did not verify')
    return group.gr_gid

def _ensure_directory(path: Path, *, gid: int, mode: int) -> None:
    info = os.lstat(path)
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise MigrationError(f'fixed lock namespace directory is unsafe: {path}')
    os.chown(path, 0, gid, follow_symlinks=False)
    os.chmod(path, mode, follow_symlinks=False)
    final = os.lstat(path)
    if (final.st_uid, final.st_gid, stat.S_IMODE(final.st_mode)) != (0, gid, mode):
        raise MigrationError(f'fixed lock namespace permissions did not apply: {path}')
