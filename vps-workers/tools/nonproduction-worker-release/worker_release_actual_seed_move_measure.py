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

MOVE_REASONS = frozenset({
    "paths-invalid", "directory-unsafe", "filesystem-mismatch", "source-changed",
    "atomic-rename-unavailable", "target-exists", "move-failed", "inode-not-preserved",
    "tree-changed", "tree-unsafe", "tree-shared-inode", "tree-size-bound",
    "tree-entry-bound", "tree-index-invalid", "tree-measurement-failed", "filesystem-error",
})
MOVE_SUBSTAGES = frozenset({
    "path-check", "open-source-parent", "open-destination-parent", "open-inputs",
    "create-destination", "filesystem-check", "measure-cache-before", "measure-store-before",
    "move-cache", "move-store", "measure-cache-after", "measure-store-after",
    "verify-cache-inode", "verify-store-inode",
})


class SeedMoveMeasurementRejected(RuntimeError):
    """A safe, bounded reason for a measurement failure; contains no raw error text."""

    def __init__(self, reason: str, substage: str):
        self.safe_reason = reason if reason in MOVE_REASONS else "tree-measurement-failed"
        self.safe_substage = substage if substage in MOVE_SUBSTAGES else "path-check"
        super().__init__(self.safe_reason)


def _callback_reason(error: BaseException) -> str:
    if isinstance(error, OSError):
        return "filesystem-error"
    if isinstance(error, RuntimeError):
        message = str(error)
        return {
            "measured tree changed during measurement": "tree-changed",
            "measured tree contains an unsafe entry or exceeds entry bound": "tree-unsafe",
            "measured tree contains a shared file inode": "tree-shared-inode",
            "measured tree exceeds configured size bound": "tree-size-bound",
            "measured tree has too many entries": "tree-entry-bound",
            "measured tree excluded index changed after validation": "tree-index-invalid",
            "measured tree has an invalid excluded index path": "tree-index-invalid",
        }.get(message, "tree-measurement-failed")
    return "tree-measurement-failed"


def _measure(measure: Callable[[Path], tuple[int, int]], path: Path, substage: str) -> tuple[int, int]:
    try:
        return measure(path)
    except Exception as error:
        raise SeedMoveMeasurementRejected(_callback_reason(error), substage) from None


def _open_dir(path: Path, substage: str) -> int:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise SeedMoveMeasurementRejected("filesystem-error", substage) from None
    info = os.fstat(fd)
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
        os.close(fd)
        raise SeedMoveMeasurementRejected("directory-unsafe", substage)
    return fd


def move_inputs_and_measure(cache: Path, store: Path, destination: Path, *,
                            measure: Callable[[Path], tuple[int, int]]) -> dict[str, object]:
    """Rename actual cache/store inputs to a fresh sibling seed tree, no copy."""
    if (cache.name != "cache" or store.name != "store" or cache.parent != store.parent
            or destination.exists() or destination.is_symlink()):
        raise SeedMoveMeasurementRejected("paths-invalid", "path-check")
    try:
        destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    except OSError:
        raise SeedMoveMeasurementRejected("filesystem-error", "create-destination") from None
    parent_fd = _open_dir(cache.parent, "open-source-parent")
    try:
        destination_parent_fd = _open_dir(destination.parent, "open-destination-parent")
    except Exception:
        os.close(parent_fd)
        raise
    cache_fd = store_fd = destination_fd = -1
    try:
        try:
            cache_fd = os.open("cache", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
            store_fd = os.open("store", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except OSError:
            raise SeedMoveMeasurementRejected("filesystem-error", "open-inputs") from None
        target_name = destination.name
        try:
            os.mkdir(target_name, 0o700, dir_fd=destination_parent_fd)
            os.fsync(destination_parent_fd)
            destination_fd = os.open(target_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                     dir_fd=destination_parent_fd)
        except OSError:
            raise SeedMoveMeasurementRejected("filesystem-error", "create-destination") from None
        target = os.fstat(destination_fd)
        cache_info, store_info = os.fstat(cache_fd), os.fstat(store_fd)
        if (cache_info.st_dev, store_info.st_dev, target.st_dev) != (target.st_dev,) * 3:
            raise SeedMoveMeasurementRejected("filesystem-mismatch", "filesystem-check")
        expected = {"cache": (cache_info.st_dev, cache_info.st_ino),
                    "store": (store_info.st_dev, store_info.st_ino)}
        before = {
            "cache": _measure(measure, cache, "measure-cache-before"),
            "store": _measure(measure, store, "measure-store-before"),
        }
        for name in ("cache", "store"):
            try:
                move_input_directory(parent_fd, destination_fd, name, expected[name])
            except OSError:
                raise SeedMoveMeasurementRejected("filesystem-error", f"move-{name}") from None
            except Exception as error:
                message = str(error)
                reason = {
                    "atomic no-replace directory rename is unavailable": "atomic-rename-unavailable",
                    "immutable source seed already exists": "target-exists",
                    "seed move input inode changed": "source-changed",
                    "seed move destination inode changed": "inode-not-preserved",
                }.get(message, "move-failed")
                raise SeedMoveMeasurementRejected(reason, f"move-{name}") from None
        after = {
            "cache": _measure(measure, destination / "cache", "measure-cache-after"),
            "store": _measure(measure, destination / "store", "measure-store-after"),
        }
        for name, path in (("cache", destination / "cache"), ("store", destination / "store")):
            info = path.stat(follow_symlinks=False)
            if (info.st_dev, info.st_ino) != expected[name]:
                raise SeedMoveMeasurementRejected("inode-not-preserved", f"verify-{name}-inode")
        if before != after:
            raise SeedMoveMeasurementRejected("tree-changed", "measure-cache-after")
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
