"""Measure copyless seed publication on the actual experiment filesystem.

This is measurement-only: callers provide a descriptor-safe tree counter and
the inputs must already have passed the experiment's validators. It is not a
production seed publisher or an attestation.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Callable

from dependency_seed_publication import move_input_directory


def _open_dir(path: Path) -> int:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        os.close(fd)
        raise RuntimeError("seed measurement directory is unsafe")
    return fd


def move_inputs_and_measure(cache: Path, store: Path, destination: Path, *,
                            measure: Callable[[Path], tuple[int, int]]) -> dict[str, object]:
    """Rename actual cache/store inputs to a fresh sibling seed tree, no copy."""
    if (cache.name != "cache" or store.name != "store" or cache.parent != store.parent
            or destination.exists() or destination.is_symlink()):
        raise RuntimeError("seed measurement paths are not fresh siblings")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent_fd = _open_dir(cache.parent)
    destination_parent_fd = _open_dir(destination.parent)
    cache_fd = store_fd = destination_fd = -1
    try:
        cache_fd = os.open("cache", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        store_fd = os.open("store", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        target_name = destination.name
        os.mkdir(target_name, 0o700, dir_fd=destination_parent_fd)
        os.fsync(destination_parent_fd)
        destination_fd = os.open(target_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=destination_parent_fd)
        target = os.fstat(destination_fd)
        cache_info, store_info = os.fstat(cache_fd), os.fstat(store_fd)
        if (cache_info.st_dev, store_info.st_dev, target.st_dev) != (target.st_dev,) * 3:
            raise RuntimeError("seed measurement inputs are not on one filesystem")
        expected = {"cache": (cache_info.st_dev, cache_info.st_ino),
                    "store": (store_info.st_dev, store_info.st_ino)}
        before = {name: measure(path) for name, path in (("cache", cache), ("store", store))}
        move_input_directory(parent_fd, destination_fd, "cache", expected["cache"])
        move_input_directory(parent_fd, destination_fd, "store", expected["store"])
        after = {name: measure(destination / name) for name in ("cache", "store")}
        for name, path in (("cache", destination / "cache"), ("store", destination / "store")):
            info = path.stat(follow_symlinks=False)
            if (info.st_dev, info.st_ino) != expected[name]:
                raise RuntimeError("seed measurement rename did not preserve input inode")
        if before != after:
            raise RuntimeError("seed measurement tree changed during same-filesystem rename")
        return {
            "same_filesystem": True,
            "copy_bytes": 0,
            "inputs": {
                name: {"entries": before[name][0], "logical_bytes": before[name][1],
                       "device": expected[name][0], "inode_preserved": True}
                for name in ("cache", "store")
            },
        }
    finally:
        if store_fd >= 0:
            os.close(store_fd)
        if cache_fd >= 0:
            os.close(cache_fd)
        if destination_fd >= 0:
            os.close(destination_fd)
        os.close(destination_parent_fd)
        os.close(parent_fd)
