"""Disconnected descriptor-anchored ownership transfer for staged releases.

This helper is a prototype and is not called by the production broker. Its
caller must create the staging directory with a dedicated one-shot extractor
UID (different from both root and the runtime worker UID), wait/reap that exact
extractor process, and pass the already-open no-follow directory FD and its
recorded device/inode. No path-based ownership changes are performed here.
"""
from __future__ import annotations

import os
import stat
import subprocess

from worker_release_descriptor_cgroup import (
    CgroupProofRejected,
    require_empty_cgroup,
    require_process_member,
)
from worker_release_descriptor_process import (
    ProcessIdentityRejected,
    assert_no_uid_processes,
    verify_live_child_identity,
)


class FreezeRejected(RuntimeError):
    """The staged tree did not satisfy the descriptor-transfer contract."""


MAX_ENTRIES = 200_000
MAX_BYTES = 8 * 1024 * 1024 * 1024
EXTRACTOR_WAIT_SECONDS = 30


def freeze_staged_tree(
    root_fd: int,
    extractor: subprocess.Popen[bytes],
    *,
    expected_dev: int,
    expected_ino: int,
    extractor_uid: int,
    extractor_gid: int,
    cgroup_fd: int,
    expected_cgroup_dev: int,
    expected_cgroup_ino: int,
    worker_uid: int,
    worker_gid: int,
    owner_uid: int = 0,
) -> dict[str, int]:
    """Reap a successful extractor then freeze its exact tree using FDs only.

    The child must still be alive so its kernel-reported real/effective/saved/
    filesystem UID and GID can be checked in procfs before it is reaped. The
    procfs UID scan is defense in depth, not process containment. Production
    also requires a verified dedicated cgroup that prevents escape outside the
    boundary and is confirmed empty before transfer. A pinned cgroup v2 FD is
    required and checked against kernel cgroup.procs/events; this helper does
    not configure the unit, prevent migration into the cgroup, or prove it is
    non-delegated.
    """
    if os.geteuid() != owner_uid:
        raise FreezeRejected("ownership transfer must run as the configured owner")
    if extractor_uid in (owner_uid, worker_uid) or worker_uid == owner_uid:
        raise FreezeRejected("extractor, worker, and owner identities must be distinct")
    if extractor.poll() is not None:
        raise FreezeRejected("extractor must remain alive for identity verification")
    try:
        verify_live_child_identity(extractor, extractor_uid, extractor_gid)
    except ProcessIdentityRejected as exc:
        raise FreezeRejected("extractor identity is not isolated") from exc
    try:
        require_process_member(cgroup_fd, expected_cgroup_dev, expected_cgroup_ino,
                               extractor.pid)
    except CgroupProofRejected as exc:
        raise FreezeRejected("extractor is not proven inside its pinned cgroup") from exc
    try:
        result = extractor.wait(timeout=EXTRACTOR_WAIT_SECONDS)
    except subprocess.TimeoutExpired as exc:
        raise FreezeRejected(
            "extractor timed out; caller must kill its entire cgroup and verify empty before retry"
        ) from exc
    if result != 0 or extractor.returncode != 0:
        raise FreezeRejected("extractor failed; caller must stop and drain its cgroup")
    try:
        require_empty_cgroup(cgroup_fd, expected_cgroup_dev, expected_cgroup_ino)
    except CgroupProofRejected as exc:
        raise FreezeRejected("extractor cgroup is not proven empty") from exc
    try:
        assert_no_uid_processes(extractor_uid)
    except ProcessIdentityRejected as exc:
        raise FreezeRejected("extractor UID process cleanup failed") from exc

    root_info = os.fstat(root_fd)
    if (not stat.S_ISDIR(root_info.st_mode)
            or (root_info.st_dev, root_info.st_ino) != (expected_dev, expected_ino)
            or root_info.st_uid != extractor_uid
            or root_info.st_gid != extractor_gid
            or root_info.st_mode & 0o6022):
        raise FreezeRejected("staging root identity or permissions changed")

    inventory = _inventory_tree(root_fd, expected_dev, extractor_uid, extractor_gid)

    counters = {"entries": 0, "bytes": 0}
    _freeze_directory(root_fd, "", expected_dev, extractor_uid, extractor_gid,
                      worker_gid,
                      owner_uid, counters, inventory)
    if counters["entries"] != len(inventory) - 1:
        raise FreezeRejected("tree membership changed during ownership transfer")
    frozen_root = os.fstat(root_fd)
    if (frozen_root.st_uid != owner_uid or frozen_root.st_gid != worker_gid
            or stat.S_IMODE(frozen_root.st_mode) != 0o550):
        raise FreezeRejected("staging root did not reach the frozen ownership state")
    _verify_frozen_tree(root_fd, inventory, expected_dev, owner_uid, worker_gid)
    return counters


def _verify_frozen_tree(root_fd: int, inventory: dict[str, tuple[int, ...]],
                        expected_dev: int, owner_uid: int, owner_gid: int) -> None:
    """Require exact post-transfer path/inode membership and metadata."""
    seen = {""}
    root = os.fstat(root_fd)
    if ((root.st_dev, root.st_ino) != inventory[""][:2]
            or root.st_dev != expected_dev or root.st_uid != owner_uid
            or root.st_gid != owner_gid or stat.S_IMODE(root.st_mode) != 0o550):
        raise FreezeRejected("frozen root identity changed")

    def visit(fd: int, prefix: str) -> None:
        for name in sorted(os.listdir(fd)):
            if name in ("", ".", "..") or "/" in name or "\\" in name:
                raise FreezeRejected("frozen tree contains invalid path")
            path = f"{prefix}/{name}" if prefix else name
            if path in seen or path not in inventory:
                raise FreezeRejected("frozen tree membership differs from preflight")
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            original = inventory[path]
            if ((info.st_dev, info.st_ino) != original[:2]
                    or info.st_dev != expected_dev or info.st_uid != owner_uid
                    or info.st_gid != owner_gid):
                raise FreezeRejected("frozen inode identity or ownership changed")
            seen.add(path)
            if stat.S_ISDIR(info.st_mode):
                if stat.S_IMODE(info.st_mode) != 0o550:
                    raise FreezeRejected("frozen directory mode is incorrect")
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=fd)
                try:
                    opened = os.fstat(child)
                    if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                        raise FreezeRejected("frozen directory changed during verification")
                    visit(child, path)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode):
                expected_mode = 0o550 if original[3] & 0o111 else 0o440
                if (stat.S_IMODE(info.st_mode) != expected_mode or info.st_nlink != 1
                        or info.st_size != original[7]):
                    raise FreezeRejected("frozen file mode or metadata is incorrect")
            else:
                raise FreezeRejected("frozen tree contains a link or special file")

    visit(root_fd, "")
    if seen != set(inventory):
        raise FreezeRejected("frozen tree is missing preflight entries")


def _identity(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode),
            stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _inventory_tree(root_fd: int, expected_dev: int, extractor_uid: int,
                    extractor_gid: int) -> dict[str, tuple[int, ...]]:
    """Validate every inode before changing any ownership or mode."""
    inventory: dict[str, tuple[int, ...]] = {"": _identity(os.fstat(root_fd))}

    def visit(fd: int, prefix: str) -> None:
        for name in sorted(os.listdir(fd)):
            if name in ("", ".", "..") or "/" in name or "\\" in name:
                raise FreezeRejected("tree contains an invalid entry name")
            path = f"{prefix}/{name}" if prefix else name
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if path in inventory or len(inventory) >= MAX_ENTRIES:
                raise FreezeRejected("tree has duplicate paths or exceeds entry limit")
            if (info.st_dev != expected_dev or info.st_uid != extractor_uid
                    or info.st_gid != extractor_gid or info.st_mode & 0o6022):
                raise FreezeRejected("entry ownership, device, or mode is unsafe")
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    if _identity(os.fstat(child)) != _identity(info):
                        raise FreezeRejected("directory changed during preflight")
                    inventory[path] = _identity(info)
                    visit(child, path)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                inventory[path] = _identity(info)
            else:
                raise FreezeRejected("tree contains a link, shared inode, or special file")

    visit(root_fd, "")
    if sum(item[7] for item in inventory.values()
           if item[2] == stat.S_IFREG) > MAX_BYTES:
        raise FreezeRejected("tree exceeds byte limit")
    return inventory


def _freeze_directory(directory_fd: int, prefix: str, expected_dev: int, extractor_uid: int,
                      extractor_gid: int, worker_gid: int, owner_uid: int,
                      counters: dict[str, int], inventory: dict[str, tuple[int, ...]]) -> None:
    info = os.fstat(directory_fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_dev != expected_dev
            or info.st_uid != extractor_uid or info.st_gid != extractor_gid
            or info.st_mode & 0o6022 or inventory.get(prefix) != _identity(info)):
        raise FreezeRejected("directory ownership, device, or mode is unsafe")
    for name in sorted(os.listdir(directory_fd)):
        if name in ("", ".", "..") or "/" in name or "\\" in name:
            raise FreezeRejected("tree contains an invalid entry name")
        before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        path = f"{prefix}/{name}" if prefix else name
        if inventory.get(path) != _identity(before):
            raise FreezeRejected("entry changed after transfer preflight")
        counters["entries"] += 1
        if counters["entries"] > MAX_ENTRIES:
            raise FreezeRejected("tree exceeds entry limit")
        if (before.st_dev != expected_dev or before.st_uid != extractor_uid
                or before.st_gid != extractor_gid or before.st_mode & 0o6022):
            raise FreezeRejected("entry ownership, device, or mode is unsafe")
        if stat.S_ISDIR(before.st_mode):
            child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=directory_fd)
            try:
                opened = os.fstat(child_fd)
                if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
                    raise FreezeRejected("directory entry changed during traversal")
                _freeze_directory(child_fd, path, expected_dev, extractor_uid, extractor_gid,
                                  worker_gid,
                                  owner_uid, counters, inventory)
            finally:
                os.close(child_fd)
        elif stat.S_ISREG(before.st_mode):
            if before.st_nlink != 1 or before.st_size < 0:
                raise FreezeRejected("file has shared links or invalid size")
            counters["bytes"] += before.st_size
            if counters["bytes"] > MAX_BYTES:
                raise FreezeRejected("tree exceeds byte limit")
            file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                              dir_fd=directory_fd)
            try:
                opened = os.fstat(file_fd)
                if (_identity(opened) != inventory[path]
                        or opened.st_nlink != 1 or opened.st_uid != extractor_uid
                        or opened.st_gid != extractor_gid or not stat.S_ISREG(opened.st_mode)):
                    raise FreezeRejected("file changed during descriptor open")
                os.fchown(file_fd, owner_uid, worker_gid)
                os.fchmod(file_fd, 0o550 if opened.st_mode & 0o111 else 0o440)
                os.fsync(file_fd)
            finally:
                os.close(file_fd)
        else:
            raise FreezeRejected("tree contains a link or special file")
    os.fchown(directory_fd, owner_uid, worker_gid)
    os.fchmod(directory_fd, 0o550)
    os.fsync(directory_fd)
__all__ = ["FreezeRejected", "freeze_staged_tree"]
