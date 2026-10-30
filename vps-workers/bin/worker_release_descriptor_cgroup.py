"""Kernel-backed cgroup v2 checks for the disconnected freeze prototype."""
from __future__ import annotations

import ctypes
import os
import stat
import sys


CGROUP2_SUPER_MAGIC = 0x63677270
MAX_PROCS_BYTES = 1024 * 1024
MAX_EVENTS_BYTES = 4096


class CgroupProofRejected(RuntimeError):
    """The supplied kernel cgroup descriptor did not prove expected state."""


def _require_cgroup2_fd(fd: int, expected_dev: int, expected_ino: int) -> None:
    if not sys.platform.startswith("linux"):
        raise CgroupProofRejected("cgroup v2 proof is supported only on Linux")
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != (expected_dev, expected_ino):
        raise CgroupProofRejected("cgroup directory descriptor identity changed")
    buffer = ctypes.create_string_buffer(256)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.fstatfs(ctypes.c_int(fd), ctypes.byref(buffer)) != 0:
        raise CgroupProofRejected("cannot identify cgroup filesystem")
    if ctypes.c_long.from_buffer(buffer).value != CGROUP2_SUPER_MAGIC:
        raise CgroupProofRejected("descriptor is not on a cgroup v2 filesystem")


def _read_control_file(cgroup_fd: int, name: str, limit: int) -> bytes:
    if name not in ("cgroup.procs", "cgroup.events"):
        raise CgroupProofRejected("unsupported cgroup control file")
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=cgroup_fd)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise CgroupProofRejected("cgroup control file is not readable")
        chunks = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > limit:
            raise CgroupProofRejected("cgroup control file exceeds its bound")
        return raw
    finally:
        os.close(fd)


def parse_cgroup_procs(raw: bytes) -> frozenset[int]:
    try:
        values = [int(line) for line in raw.decode("ascii").splitlines() if line]
    except (UnicodeDecodeError, ValueError) as exc:
        raise CgroupProofRejected("cgroup process list is malformed") from exc
    if any(pid <= 0 for pid in values) or len(values) != len(set(values)):
        raise CgroupProofRejected("cgroup process list has invalid or duplicate PIDs")
    return frozenset(values)


def parse_populated(raw: bytes) -> bool:
    try:
        rows = [line.split() for line in raw.decode("ascii").splitlines()]
    except UnicodeDecodeError as exc:
        raise CgroupProofRejected("cgroup event list is malformed") from exc
    values = [row[1] for row in rows if len(row) == 2 and row[0] == "populated"]
    if len(values) != 1 or values[0] not in ("0", "1"):
        raise CgroupProofRejected("cgroup populated event is missing or ambiguous")
    return values[0] == "1"


def require_process_member(cgroup_fd: int, expected_dev: int, expected_ino: int, pid: int) -> None:
    """Bind the live extractor PID to the caller-pinned cgroup before wait."""
    _require_cgroup2_fd(cgroup_fd, expected_dev, expected_ino)
    pids = parse_cgroup_procs(_read_control_file(cgroup_fd, "cgroup.procs", MAX_PROCS_BYTES))
    if pid not in pids:
        raise CgroupProofRejected("extractor is not a direct process in the pinned cgroup")


def require_empty_cgroup(cgroup_fd: int, expected_dev: int, expected_ino: int) -> None:
    """Prove no process remains after reaping; caller must prevent migration in."""
    _require_cgroup2_fd(cgroup_fd, expected_dev, expected_ino)
    before = parse_populated(_read_control_file(cgroup_fd, "cgroup.events", MAX_EVENTS_BYTES))
    pids = parse_cgroup_procs(_read_control_file(cgroup_fd, "cgroup.procs", MAX_PROCS_BYTES))
    after = parse_populated(_read_control_file(cgroup_fd, "cgroup.events", MAX_EVENTS_BYTES))
    if before or after or pids:
        raise CgroupProofRejected("extractor cgroup is not empty")


__all__ = [
    "CgroupProofRejected", "parse_cgroup_procs", "parse_populated",
    "require_process_member", "require_empty_cgroup",
]
