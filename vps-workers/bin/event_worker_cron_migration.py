"""Fixed event/quiz cron cutover primitives shared by migration tests."""

from __future__ import annotations

import fcntl
import grp
import hashlib
import os
import stat
import time
from pathlib import Path


LEGACY_CRON_SCHEDULES = {
    "process-domain-events": ("/bin/process-domain-events.sh", "process-domain-events.lock", "event-pipeline", "--once"),
    "process-event-deliveries": ("/bin/process-event-deliveries.sh", "process-event-deliveries.lock", "event-pipeline", "--once"),
    "process-quiz-finalization": ("/bin/process-quiz-finalization.sh", "quiz-finalize.lock", "quiz-finalization", "--once"),
    "quiz-finalize-route": ("/api/quiz/finalize", "quiz-finalize.lock", "run-web-cron.mjs", None),
}
MAX_LOCK_DRAIN_SECONDS = 30


def remove_legacy_worker_cron_rows(text: str) -> tuple[str, list[str]]:
    """Remove only recognized event/quiz schedules replaced by system units."""
    output: list[str] = []
    removed: list[str] = []
    for line in text.splitlines(keepends=True):
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            output.append(line)
            continue
        matches = [(name, contract) for name, contract in LEGACY_CRON_SCHEDULES.items()
                   if contract[0] in line]
        if not matches:
            output.append(line)
            continue
        if len(matches) != 1:
            raise RuntimeError("cron row ambiguously matches multiple legacy worker schedules")
        name, (command_marker, lock_name, profile_or_runner, once_arg) = matches[0]
        valid = ("flock -n " in line and f"/{lock_name} " in line and
                 "bash -lc '" in line and command_marker in line and profile_or_runner in line)
        if once_arg:
            valid = valid and once_arg in line and f"BACI_WORKER_PROFILE={profile_or_runner}" in line
        else:
            valid = valid and "run-web-cron.mjs" in line
        if not valid:
            raise RuntimeError(f"legacy worker cron row is outside the fixed cleanup contract: {name}")
        removed.append(name)
    return "".join(output), removed


def validate_lock_inodes(root: Path, lock_names: tuple[str, ...], *, root_uid: int, lock_gid: int) -> dict[str, tuple[int, int]]:
    """Validate existing shared-lock inodes without changing them."""
    inodes: dict[str, tuple[int, int]] = {}
    for lock_name in lock_names:
        path = root / "locks" / lock_name
        try:
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        except OSError as error:
            raise RuntimeError(f"protected worker lock is unavailable: {lock_name}") from error
        try:
            metadata = os.fstat(fd)
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != root_uid or
                    metadata.st_gid != lock_gid or metadata.st_nlink != 1 or
                    stat.S_IMODE(metadata.st_mode) != 0o660):
                raise RuntimeError(f"protected worker lock is unsafe: {lock_name}")
            inodes[lock_name] = (metadata.st_dev, metadata.st_ino)
        finally:
            os.close(fd)
    return inodes


def drain_worker_locks(root: Path, lock_names: tuple[str, ...], *, lock_gid: int,
                       timeout_seconds: int = MAX_LOCK_DRAIN_SECONDS) -> None:
    """Wait for already-started legacy invocations to leave fixed flock files."""
    descriptors: list[int] = []
    try:
        for lock_name in lock_names:
            path = root / "locks" / lock_name
            fd = os.open(path, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))
            descriptors.append(fd)
            metadata = os.fstat(fd)
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or
                    metadata.st_gid != lock_gid or metadata.st_nlink != 1 or
                    stat.S_IMODE(metadata.st_mode) != 0o660):
                raise RuntimeError(f"worker lock file is unsafe: {lock_name}")
            deadline = time.monotonic() + timeout_seconds
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f"legacy worker invocation did not drain: {lock_name}")
                    time.sleep(0.1)
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def write_crontab_backup(path: Path, text: str, *, root_uid: int, root_gid: int) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchown(fd, root_uid, root_gid)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            path.unlink()
        except OSError:
            pass
        raise


def validated_crontab_snapshot(path: Path, expected_sha: str, *, root_uid: int) -> str:
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or
            info.st_uid != root_uid or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
        raise RuntimeError("event worker cron rollback snapshot is unsafe")
    content = path.read_text(encoding="utf-8")
    if hashlib.sha256(content.encode()).hexdigest() != expected_sha:
        raise RuntimeError("event worker cron rollback snapshot changed")
    return content
