"""Crash-fenced root locking and staging journal for the seed prototype."""
from __future__ import annotations

import fcntl
import errno
import json
import os
import re
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import open_directory

JOURNAL = ".publish-inflight.json"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
STAGING_RE = re.compile(r"^\.([0-9a-f]{40})\.([0-9a-f]{32})$")
BOOT_ID_RE = re.compile(r"^[0-9a-f-]{36}$")


def seed_lock(root: Path) -> tuple[int, int]:
    root_fd = open_directory(root, owner_uid=os.geteuid(), create=True)
    try:
        fd = os.open(".publish.lock", os.O_RDWR | os.O_CREAT
                     | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=root_fd)
    except BaseException:
        os.close(root_fd)
        raise
    return _lock_and_validate(root_fd, fd)


def existing_seed_lock(root: Path) -> tuple[int, int]:
    root_fd = open_directory(root, owner_uid=os.geteuid())
    try:
        fd = os.open(".publish.lock", os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
                     dir_fd=root_fd)
    except BaseException:
        os.close(root_fd)
        raise BuilderRejected("seed publish lock is unavailable")
    return _lock_and_validate(root_fd, fd)


def _lock_and_validate(root_fd: int, fd: int) -> tuple[int, int]:
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or info.st_mode & 0o077):
        os.close(fd)
        os.close(root_fd)
        raise BuilderRejected("seed publish lock is unsafe")
    fcntl.flock(fd, fcntl.LOCK_EX)
    try:
        named = os.stat(".publish.lock", dir_fd=root_fd, follow_symlinks=False)
    except OSError as exc:
        os.close(fd)
        os.close(root_fd)
        raise BuilderRejected("seed publish lock name changed") from exc
    if (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino):
        os.close(fd)
        os.close(root_fd)
        raise BuilderRejected("seed publish lock name changed")
    return root_fd, fd


def require_held_seed_lock(root_fd: int, lock_fd: int) -> None:
    """Acquire/confirm the pinned root lock nonblocking before recovery writes."""
    info = os.fstat(lock_fd)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or info.st_mode & 0o077):
        raise BuilderRejected("seed publish lock is unsafe")
    try:
        named = os.stat(".publish.lock", dir_fd=root_fd, follow_symlinks=False)
    except OSError as exc:
        raise BuilderRejected("seed publish lock name changed") from exc
    if (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino):
        raise BuilderRejected("seed publish lock name changed")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as exc:
        raise BuilderRejected("seed publish lock is held by another publisher") from exc
    named = os.stat(".publish.lock", dir_fd=root_fd, follow_symlinks=False)
    if (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino):
        raise BuilderRejected("seed publish lock name changed")


def named_root_matches(path: Path, fd: int) -> bool:
    try:
        path_info = path.lstat()
    except OSError:
        return False
    opened = os.fstat(fd)
    return (stat.S_ISDIR(path_info.st_mode)
            and (path_info.st_dev, path_info.st_ino) == (opened.st_dev, opened.st_ino))


def _boot_id() -> str:
    try:
        with open("/proc/sys/kernel/random/boot_id", encoding="ascii") as handle:
            value = handle.read(64).strip()
    except OSError as exc:
        raise BuilderRejected("seed recovery requires kernel boot identity") from exc
    if not BOOT_ID_RE.fullmatch(value):
        raise BuilderRejected("seed recovery boot identity is malformed")
    return value


def _process_start_ticks(pid: int) -> tuple[str, int]:
    try:
        with open(f"/proc/{pid}/stat", encoding="ascii") as handle:
            raw = handle.read(4096)
    except OSError as exc:
        raise BuilderRejected("seed recovery process identity is unavailable") from exc
    closing = raw.rfind(")")
    if closing < 0:
        raise BuilderRejected("seed recovery process identity is malformed")
    fields = raw[closing + 1:].split()
    try:
        state = fields[0]
        start_ticks = int(fields[19])
    except (IndexError, ValueError) as exc:
        raise BuilderRejected("seed recovery process identity is malformed") from exc
    if start_ticks < 1:
        raise BuilderRejected("seed recovery process identity is malformed")
    return state, start_ticks


def process_identity() -> dict[str, int | str]:
    state, start_ticks = _process_start_ticks(os.getpid())
    if state not in {"R", "S", "D", "T", "t", "W", "X", "x", "K", "P", "I"}:
        raise BuilderRejected("seed publisher process state is unexpected")
    return {"pid": os.getpid(), "startTicks": start_ticks, "bootId": _boot_id()}


def create_inflight_journal(root_fd: int, sha: str, staging_name: str) -> int:
    if not SHA_RE.fullmatch(sha) or not STAGING_RE.fullmatch(staging_name):
        raise BuilderRejected("seed journal identity is malformed")
    value = {"schema": 1, "sourceSha": sha, "stagingName": staging_name,
             "stagingDevice": None, "stagingInode": None, **process_identity()}
    fd = os.open(JOURNAL, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                 | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=root_fd)
    try:
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise BuilderRejected("seed journal short write")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(root_fd)
    journal_fd = os.open(JOURNAL, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), dir_fd=root_fd)
    info = os.fstat(journal_fd)
    named = os.stat(JOURNAL, dir_fd=root_fd, follow_symlinks=False)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or info.st_mode & 0o077
            or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)):
        os.close(journal_fd)
        raise BuilderRejected("seed journal inode or permissions are unsafe")
    return journal_fd


def update_inflight_journal(root_fd: int, journal_fd: int, staging_fd: int) -> None:
    journal_info = os.fstat(journal_fd)
    named = os.stat(JOURNAL, dir_fd=root_fd, follow_symlinks=False)
    if (not stat.S_ISREG(journal_info.st_mode) or journal_info.st_uid != os.geteuid()
            or journal_info.st_nlink != 1 or journal_info.st_mode & 0o077
            or (named.st_dev, named.st_ino) != (journal_info.st_dev, journal_info.st_ino)):
        raise BuilderRejected("seed journal inode or permissions changed")
    staging_info = os.fstat(staging_fd)
    value, read_fd = read_inflight_journal(root_fd)
    read_info = os.fstat(read_fd)
    os.close(read_fd)
    if (read_info.st_dev, read_info.st_ino) != (journal_info.st_dev, journal_info.st_ino):
        raise BuilderRejected("seed journal inode changed during update")
    value["stagingDevice"] = staging_info.st_dev
    value["stagingInode"] = staging_info.st_ino
    _replace_contents(journal_fd, root_fd, value)


def _replace_contents(fd: int, root_fd: int, value: dict[str, object]) -> None:
    payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
    os.ftruncate(fd, 0)
    os.lseek(fd, 0, os.SEEK_SET)
    view = memoryview(payload)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise BuilderRejected("seed journal short write")
        view = view[written:]
    os.fsync(fd)
    info = os.fstat(fd)
    named = os.stat(JOURNAL, dir_fd=root_fd, follow_symlinks=False)
    if (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino):
        raise BuilderRejected("seed journal name changed")


def read_inflight_journal(root_fd: int) -> tuple[dict[str, object], int]:
    try:
        fd = os.open(JOURNAL, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=root_fd)
    except OSError as exc:
        raise BuilderRejected("seed journal is unavailable") from exc
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink != 1 or info.st_mode & 0o077 or info.st_size > 2048):
            raise BuilderRejected("seed journal permissions or type are unsafe")
        raw = os.read(fd, 2049)
        value = json.loads(raw)
        expected = {"schema", "sourceSha", "stagingName", "stagingDevice", "stagingInode",
                    "pid", "startTicks", "bootId"}
        if (not isinstance(value, dict) or set(value) != expected or value.get("schema") != 1
                or not isinstance(value.get("sourceSha"), str)
                or not SHA_RE.fullmatch(value["sourceSha"])
                or not isinstance(value.get("stagingName"), str)
                or not STAGING_RE.fullmatch(value["stagingName"])
                or value["stagingName"].split(".")[1] != value["sourceSha"]
                or (value["stagingDevice"] is None) != (value["stagingInode"] is None)
                or (value["stagingDevice"] is not None and
                    (type(value["stagingDevice"]) is not int or type(value["stagingInode"]) is not int
                     or value["stagingDevice"] < 0 or value["stagingInode"] < 1))
                or type(value.get("pid")) is not int or value["pid"] < 1
                or type(value.get("startTicks")) is not int or value["startTicks"] < 1
                or not isinstance(value.get("bootId"), str)
                or not BOOT_ID_RE.fullmatch(value["bootId"])):
            raise BuilderRejected("seed journal schema or identity is invalid")
        return value, fd
    except BuilderRejected:
        os.close(fd)
        raise
    except (OSError, ValueError, TypeError) as exc:
        os.close(fd)
        raise BuilderRejected("seed journal cannot be parsed safely") from exc


def publisher_is_terminal(value: dict[str, object]) -> bool:
    current_boot = _boot_id()
    if current_boot != value["bootId"]:
        return True
    try:
        state, ticks = _process_start_ticks(value["pid"])
    except BuilderRejected as exc:
        cause = exc.__cause__
        if isinstance(cause, OSError) and cause.errno in {errno.ENOENT, errno.ESRCH}:
            return True
        raise
    return state == "Z" or ticks != value["startTicks"]


def clear_inflight_journal(root_fd: int, journal_fd: int) -> None:
    pinned = os.fstat(journal_fd)
    named = os.stat(JOURNAL, dir_fd=root_fd, follow_symlinks=False)
    if (pinned.st_dev, pinned.st_ino) != (named.st_dev, named.st_ino):
        raise BuilderRejected("seed journal name changed before clear")
    os.unlink(JOURNAL, dir_fd=root_fd)
    os.fsync(root_fd)


def reject_unresolved_staging(root_fd: int) -> None:
    """Refuse recovery ambiguities; this prototype never deletes stale paths."""
    for name in os.listdir(root_fd):
        if name == ".publish.lock":
            continue
        if name == JOURNAL:
            raise BuilderRejected("unresolved seed journal requires recovery")
        if STAGING_RE.fullmatch(name):
            raise BuilderRejected("unresolved seed staging entry requires recovery")
        if SHA_RE.fullmatch(name):
            continue
        raise BuilderRejected("seed root contains an unknown entry")
