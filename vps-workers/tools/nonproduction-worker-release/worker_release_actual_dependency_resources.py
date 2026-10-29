"""Bounded filesystem resource checks for the disposable CI experiment."""
from __future__ import annotations

import os
import stat
import time
from pathlib import Path

MAX_TREE_BYTES = 12 * 1024 * 1024 * 1024
MAX_TREE_ENTRIES = 1_000_000
MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
MIN_FREE_INODES = 20_000
SCAN_RETRIES = 3
SCAN_RETRY_SECONDS = 0.1


class _TransientEntryRace(Exception):
    pass


class ResourceEntryLimitExceeded(RuntimeError):
    def __init__(self, entries_seen: int, limit: int):
        self.entries_seen = entries_seen
        self.limit = limit
        super().__init__("experiment resource entry cap exceeded")


def enforce_resource_limits(root: Path, *, max_bytes: int = MAX_TREE_BYTES,
                             max_entries: int = MAX_TREE_ENTRIES,
                             min_free_bytes: int = MIN_FREE_BYTES,
                             min_free_inodes: int = MIN_FREE_INODES,
                             live_sample: bool = False) -> tuple[int, int]:
    try:
        root_info = root.lstat()
    except FileNotFoundError as exc:
        raise RuntimeError("experiment resource root disappeared") from exc
    if not stat.S_ISDIR(root_info.st_mode) or root.is_symlink():
        raise RuntimeError("experiment resource root is unsafe")
    root_identity = (root_info.st_dev, root_info.st_ino)

    def on_walk_error(error: OSError) -> None:
        if isinstance(error, FileNotFoundError):
            if live_sample:
                return
            raise _TransientEntryRace() from error
        raise error

    for attempt in range(1 if live_sample else SCAN_RETRIES):
        count = total = 0
        try:
            for current, directories, files in os.walk(root, topdown=True, followlinks=False,
                                                       onerror=on_walk_error):
                current_path = Path(current)
                for name in directories + files:
                    path = current_path / name
                    try:
                        info = path.lstat()
                    except FileNotFoundError as exc:
                        if live_sample:
                            continue
                        raise _TransientEntryRace() from exc
                    count += 1
                    if count > max_entries:
                        raise ResourceEntryLimitExceeded(count, max_entries)
                    if stat.S_ISREG(info.st_mode):
                        total += info.st_size
                        if total > max_bytes:
                            raise RuntimeError("experiment disk cap exceeded")
                    elif not (stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)):
                        raise RuntimeError("experiment contains an unsupported filesystem entry")
                directories[:] = [name for name in directories if not (current_path / name).is_symlink()]
            break
        except _TransientEntryRace as exc:
            if attempt + 1 == SCAN_RETRIES:
                raise RuntimeError("experiment tree changed repeatedly during resource scan") from exc
            time.sleep(SCAN_RETRY_SECONDS * (attempt + 1))
    try:
        final_root = root.lstat()
    except FileNotFoundError as exc:
        raise RuntimeError("experiment resource root disappeared") from exc
    if (not stat.S_ISDIR(final_root.st_mode) or root.is_symlink()
            or (final_root.st_dev, final_root.st_ino) != root_identity):
        raise RuntimeError("experiment resource root changed")
    space = os.statvfs(root)
    if space.f_bavail * space.f_frsize < min_free_bytes:
        raise RuntimeError("experiment free-space reserve reached")
    if space.f_favail < min_free_inodes:
        raise RuntimeError("experiment free-inode reserve reached")
    return count, total


__all__ = ["MAX_TREE_BYTES", "MAX_TREE_ENTRIES", "MIN_FREE_BYTES", "MIN_FREE_INODES",
           "ResourceEntryLimitExceeded", "enforce_resource_limits"]
