"""Atomic no-replace directory publication for the disconnected seed prototype."""
from __future__ import annotations

import ctypes
import errno
import os
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import open_directory


def rename_noreplace(parent_fd: int, source: str, destination: str,
                     destination_fd: int | None = None) -> None:
    """Atomically rename between pinned directories without replacing a target."""
    for component in (source, destination):
        if (not component or component in {".", ".."} or "/" in component
                or "\\" in component or "\x00" in component):
            raise BuilderRejected("seed publication name is malformed")
    libc = ctypes.CDLL(None, use_errno=True)
    target_fd = parent_fd if destination_fd is None else destination_fd
    if hasattr(libc, "renameat2"):
        function = libc.renameat2
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                             ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        result = function(parent_fd, os.fsencode(source), target_fd,
                          os.fsencode(destination), 1)
    elif hasattr(libc, "renameatx_np"):
        function = libc.renameatx_np
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                             ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        result = function(parent_fd, os.fsencode(source), target_fd,
                          os.fsencode(destination), 0x00000004)
    else:
        raise BuilderRejected("atomic no-replace directory rename is unavailable")
    if result != 0:
        error = ctypes.get_errno()
        if error == errno.EEXIST:
            raise BuilderRejected("immutable source seed already exists")
        raise OSError(error, "atomic seed publication failed")


def open_move_source_parent(cache: Path, store: Path, cache_fd: int,
                            store_fd: int, root_fd: int) -> tuple[int, dict[str, int]]:
    """Pin sibling cache/store parent and capture exact inodes before rename."""
    if cache.name != "cache" or store.name != "store" or cache.parent != store.parent:
        raise BuilderRejected("seed move inputs must be cache/store siblings")
    parent_fd = open_directory(cache.parent, owner_uid=os.geteuid())
    try:
        parent, root = os.fstat(parent_fd), os.fstat(root_fd)
        cache_info, store_info = os.fstat(cache_fd), os.fstat(store_fd)
        if (parent.st_dev != root.st_dev or cache_info.st_dev != root.st_dev
                or store_info.st_dev != root.st_dev):
            raise BuilderRejected("seed move inputs and canonical root are on different filesystems")
        for name, info in (("cache", cache_info), ("store", store_info)):
            named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if (not stat.S_ISDIR(named.st_mode)
                    or (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino)):
                raise BuilderRejected("seed move input changed before journal")
        return parent_fd, {
            "parentDevice": parent.st_dev, "parentInode": parent.st_ino,
            "cacheDevice": cache_info.st_dev, "cacheInode": cache_info.st_ino,
            "storeDevice": store_info.st_dev, "storeInode": store_info.st_ino,
        }
    except BaseException:
        os.close(parent_fd)
        raise


def move_input_directory(source_parent_fd: int, destination_fd: int, name: str,
                         expected: tuple[int, int]) -> None:
    """Move one journaled input without copying or replacing an entry."""
    before = os.stat(name, dir_fd=source_parent_fd, follow_symlinks=False)
    if not stat.S_ISDIR(before.st_mode) or (before.st_dev, before.st_ino) != expected:
        raise BuilderRejected("seed move input inode changed")
    rename_noreplace(source_parent_fd, name, name, destination_fd=destination_fd)
    os.fsync(source_parent_fd)
    os.fsync(destination_fd)
    after = os.stat(name, dir_fd=destination_fd, follow_symlinks=False)
    if not stat.S_ISDIR(after.st_mode) or (after.st_dev, after.st_ino) != expected:
        raise BuilderRejected("seed move destination inode changed")
