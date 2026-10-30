"""Validated lock inventory and broker-owned flock descriptors for worker releases."""
from __future__ import annotations

import fcntl
import grp
import os
import pwd
import re
import stat
import subprocess
import time
from pathlib import Path

WORKER_ROOT = Path("/srv/baci-workers")
LOCKS_DIR = WORKER_ROOT / "locks"
RELEASES_DIR = WORKER_ROOT / "releases"
CURRENT_LINK = WORKER_ROOT / "current"
RUNTIME_DIR = WORKER_ROOT / "runtime"
WORKER_ENV = RUNTIME_DIR / "worker.env"
WORKER_NAME = "baci-worker"
CRON_USER = "bassey"
LOCK_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+\.lock$")
CRON_LOCK_RE = re.compile(r"([^\s]*locks/([A-Za-z0-9_.-]+\.lock))")


class LockSetError(RuntimeError):
    """The fixed worker lock inventory or acquisition failed safely."""


class LockFDs(list[int]):
    """Open lock descriptors plus the service-owned inodes released for restart."""

    def __init__(self):
        super().__init__()
        self.service_fds: list[int] = []


def _require_metadata(path: Path, *, uid: int, gid: int, mode: int, regular: bool) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError:
        raise LockSetError("worker lock metadata is unavailable") from None
    if regular:
        valid_type = stat.S_ISREG(info.st_mode)
    else:
        valid_type = stat.S_ISDIR(info.st_mode)
    if info.st_uid != uid or info.st_gid != gid or stat.S_IMODE(info.st_mode) != mode or not valid_type:
        raise LockSetError("worker lock metadata is untrusted")
    return info


def _dotenv_global_path(worker_uid: int, worker_gid: int) -> Path:
    _require_metadata(RUNTIME_DIR, uid=worker_uid, gid=worker_gid, mode=0o700, regular=False)
    env_info = _require_metadata(WORKER_ENV, uid=worker_uid, gid=worker_gid, mode=0o600, regular=True)
    if env_info.st_nlink != 1:
        raise LockSetError("worker environment file is untrusted")
    reader = _trusted_current_dotenv_reader(worker_gid)
    command = [
        "/usr/sbin/runuser", "-u", WORKER_NAME, "--", "/bin/bash", "-c",
        '. "$1"; gigl_dotenv_value "$2" BACI_REMEDIATION_GLOBAL_LOCK_PATH',
        "_", str(reader), str(WORKER_ENV),
    ]
    try:
        result = subprocess.run(
            command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, cwd="/", env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent"},
            timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise LockSetError("worker remediation lock setting could not be read") from None
    if result.returncode != 0 or b"\n" in result.stdout.rstrip(b"\n") or b"\r" in result.stdout:
        raise LockSetError("worker remediation lock setting is invalid")
    value = result.stdout.decode("utf-8", errors="strict").strip()
    if not value:
        return LOCKS_DIR / "error-remediator-global.lock"
    candidate = Path(value) if value.startswith("/") else WORKER_ROOT / value
    if candidate.parent.resolve(strict=True) != LOCKS_DIR or not LOCK_NAME_RE.fullmatch(candidate.name):
        raise LockSetError("worker remediation lock path is outside the fixed lock directory")
    return LOCKS_DIR / candidate.name


def _trusted_current_dotenv_reader(worker_gid: int) -> Path:
    try:
        link_info = CURRENT_LINK.lstat()
        target = os.readlink(CURRENT_LINK)
    except OSError:
        raise LockSetError("current worker release pointer is unavailable") from None
    match = re.fullmatch(r"releases/([0-9a-f]{40})", target)
    if not stat.S_ISLNK(link_info.st_mode) or not match:
        raise LockSetError("current worker release pointer is untrusted")
    release_dir = RELEASES_DIR / match.group(1)
    _require_metadata(release_dir, uid=0, gid=worker_gid, mode=0o550, regular=False)
    reader = release_dir / "bin/gigl-dotenv.sh"
    reader_info = _require_metadata(reader, uid=0, gid=worker_gid, mode=0o440, regular=True)
    if reader_info.st_nlink != 1:
        raise LockSetError("worker dotenv reader has unexpected links")
    return reader


def _cron_lock_paths(lock_gid: int) -> list[Path]:
    _require_metadata(WORKER_ROOT, uid=0, gid=lock_gid, mode=0o710, regular=False)
    _require_metadata(LOCKS_DIR, uid=0, gid=lock_gid, mode=0o710, regular=False)
    try:
        result = subprocess.run(
            ["/usr/bin/crontab", "-u", CRON_USER, "-l"], stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd="/",
            env={"PATH": "/usr/bin:/bin", "HOME": "/root"}, timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise LockSetError("worker crontab inventory is unavailable") from None
    if result.returncode != 0:
        raise LockSetError("worker crontab inventory is unavailable")
    text = result.stdout.decode("utf-8", errors="strict")
    cron_paths: list[Path] = []
    for line in text.splitlines():
        for match in CRON_LOCK_RE.finditer(line):
            raw_path, name = match.groups()
            expected = LOCKS_DIR / name
            if raw_path != str(expected):
                raise LockSetError("worker crontab uses a lock outside the fixed namespace")
            cron_paths.append(expected)
    names: list[str] = []
    seen: set[str] = set()
    for path in cron_paths:
        if path.name not in seen:
            names.append(path.name)
            seen.add(path.name)
    try:
        entries = sorted(os.scandir(LOCKS_DIR), key=lambda entry: entry.name)
    except OSError:
        raise LockSetError("worker lock inventory is unavailable") from None
    for entry in entries:
        if not entry.name.endswith(".lock"):
            continue
        if not LOCK_NAME_RE.fullmatch(entry.name) or entry.is_symlink() or not entry.is_file(follow_symlinks=False):
            raise LockSetError("worker lock inventory contains an unsafe entry")
        if entry.name not in seen:
            names.append(entry.name)
            seen.add(entry.name)
    if "gigl-tracking.lock" not in seen:
        raise LockSetError("GIGL tracking lock is unavailable")
    global_path = _dotenv_global_path(pwd.getpwnam(WORKER_NAME).pw_uid, pwd.getpwnam(WORKER_NAME).pw_gid)
    if global_path.name == "gigl-tracking.lock":
        raise LockSetError("remediation lock aliases the GIGL tracking lock")
    if global_path.name not in seen:
        raise LockSetError("worker remediation lock is unavailable")
    names = [name for name in names if name != global_path.name]
    names.append(global_path.name)
    for name in names:
        _require_metadata(LOCKS_DIR / name, uid=0, gid=lock_gid, mode=0o660, regular=True)
        if (LOCKS_DIR / name).lstat().st_nlink != 1:
            raise LockSetError("worker lock inode has unexpected links")
    return [LOCKS_DIR / name for name in names]


def acquire_lock_fds(
    paths: list[Path], *, expected_uid: int, expected_gid: int,
    deadline: float, directory: Path = LOCKS_DIR,
) -> list[int]:
    """Acquire validated lock files and return FDs still owned by this process."""
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    held = LockFDs()
    try:
        for path in paths:
            name = path.name
            if not LOCK_NAME_RE.fullmatch(name) or path.parent != directory:
                raise LockSetError("worker lock path is outside the fixed directory")
            fd = -1
            try:
                before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if (
                    not stat.S_ISREG(before.st_mode) or before.st_uid != expected_uid
                    or before.st_gid != expected_gid or stat.S_IMODE(before.st_mode) != 0o660
                    or before.st_nlink != 1
                ):
                    raise LockSetError("worker lock path metadata is untrusted")
                fd = os.open(name, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
                info = os.fstat(fd)
                leaf = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if (
                    not stat.S_ISREG(info.st_mode) or info.st_uid != expected_uid
                    or info.st_gid != expected_gid or stat.S_IMODE(info.st_mode) != 0o660
                    or info.st_nlink != 1
                    or (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino)
                    or (info.st_dev, info.st_ino) != (leaf.st_dev, leaf.st_ino)
                ):
                    raise LockSetError("worker lock descriptor is untrusted")
                while True:
                    try:
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise LockSetError("worker lock acquisition timed out") from None
                        time.sleep(min(0.05, max(0.0, deadline - time.monotonic())))
                held.append(fd)
                if name in {"process-domain-events.lock", "process-event-deliveries.lock", "quiz-finalize.lock"}:
                    held.service_fds.append(fd)
            except Exception:
                if fd >= 0 and fd not in held:
                    os.close(fd)
                raise
        return held
    except Exception:
        for fd in reversed(held):
            os.close(fd)
        raise
    finally:
        os.close(directory_fd)


def acquire_production_lock_fds(*, deadline: float) -> list[int]:
    """Discover the fixed production lock set and acquire it in broker order."""
    try:
        lock_group = grp.getgrnam("baci-locks")
        worker = pwd.getpwnam(WORKER_NAME)
    except KeyError:
        raise LockSetError("worker lock identity is unavailable") from None
    if lock_group.gr_gid == 0 or lock_group.gr_gid not in os.getgrouplist(worker.pw_name, worker.pw_gid):
        raise LockSetError("worker shared lock group is invalid")
    paths = _cron_lock_paths(lock_group.gr_gid)
    return acquire_lock_fds(paths, expected_uid=0, expected_gid=lock_group.gr_gid, deadline=deadline)
