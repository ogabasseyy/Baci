"""Lock namespace parsing, inode acquisition, and migration validation."""
from __future__ import annotations

import fcntl
import os
import re
import stat
import time
from pathlib import Path
from typing import Sequence

from cache_scheduler_preflight import MigrationError

LOCK_RE = re.compile(r"flock\s+-n\s+([^\s'\"]+/locks/cache-invalidations\.lock)")


def cache_cron_lines(crontab: str, *, legacy_root: Path, protected_root: Path
                     ) -> list[tuple[int, str, str]]:
    found: list[tuple[int, str, str]] = []
    for index, line in enumerate(crontab.splitlines(keepends=True)):
        if "run-cache-invalidation-cron.mjs" not in line and "locks/cache-invalidations.lock" not in line:
            continue
        if line.lstrip().startswith("#"):
            continue
        schedule = line.split()[:5]
        lock = LOCK_RE.search(line)
        if schedule != ["*/2", "*", "*", "*", "*"] or not lock or "run-cache-invalidation-cron.mjs" not in line:
            raise MigrationError("legacy cache scheduler is not the expected two-minute cron entry")
        lock_path = Path(lock.group(1))
        if lock_path not in (legacy_root / "locks/cache-invalidations.lock",
                             protected_root / "locks/cache-invalidations.lock"):
            raise MigrationError("legacy cache scheduler lock is outside the fixed worker lock path")
        found.append((index, line, str(lock_path)))
    if len(found) != 1:
        raise MigrationError("expected exactly one active legacy cache scheduler")
    return found


def acquire_lock(path: Path, *, timeout: float = 180, held_fds: Sequence[int] = ()) -> int | None:
    try:
        fd = os.open(path, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0))
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(fd)
            raise MigrationError("cache scheduler lock is not a regular file")
        if any((held.st_dev, held.st_ino) == (info.st_dev, info.st_ino)
               for held in (os.fstat(item) for item in held_fds)):
            os.close(fd)
            return None
    except OSError as error:
        if "fd" in locals():
            os.close(fd)
        raise MigrationError("cache scheduler lock is unavailable") from error
    deadline = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            if time.monotonic() >= deadline:
                os.close(fd)
                raise MigrationError("timed out draining the cache scheduler lock")
            time.sleep(0.1)


def release_lock(fd: int | None) -> None:
    if fd is not None:
        os.close(fd)


def validate_cache_lock(path: Path, *, legacy_root: Path, protected_root: Path,
                        legacy_uid: int, legacy_gid: int, lock_gid: int,
                        owner_uid: int = 0) -> None:
    try:
        info = path.lstat()
    except OSError as error:
        raise MigrationError("cache scheduler lock is unavailable") from error
    common_safe = stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode) and info.st_nlink == 1
    if path == protected_root / "locks/cache-invalidations.lock":
        expected = (owner_uid, lock_gid, 0o660)
        actual = (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode))
        if not common_safe or actual != expected:
            raise MigrationError("protected cache scheduler lock ownership or mode is unsafe")
        return
    if path != legacy_root / "locks/cache-invalidations.lock":
        raise MigrationError("cache scheduler lock is outside the fixed worker lock path")
    if (not common_safe or info.st_uid != legacy_uid or info.st_gid != legacy_gid
            or stat.S_IMODE(info.st_mode) & 0o022):
        raise MigrationError("legacy cache scheduler lock is unsafe")
