"""Bounded filesystem resource checks for the disposable CI experiment."""
from __future__ import annotations

import os
import stat
import time
import hmac
from pathlib import Path
from typing import Callable

MAX_TREE_BYTES = 12 * 1024 * 1024 * 1024
MAX_TREE_ENTRIES = 1_000_000
MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
MIN_FREE_INODES = 20_000
SCAN_RETRIES = 3
SCAN_RETRY_SECONDS = 0.1
HIGH_WATER_STAGES = frozenset({
    "source-copy", "policy-preverify", "offline-store-validation", "build-cache-snapshot",
    "web-deploy", "worker-install", "payload-snapshot",
})


class ResourceHighWater:
    """Track peak logical bytes and entries for the production-shaped build phase.

    Logical bytes are the sum of regular-file st_size values. Allocated bytes
    are the sum of unique in-tree inode st_blocks values in 512-byte units;
    they are not physical filesystem usage. The experiment samples during
    subprocesses and accounts for copied entries synchronously while snapshotting.
    """

    def __init__(self) -> None:
        self.entries = 0
        self.bytes = 0
        self.allocated_block_bytes: int | None = None
        self.inode_count: int | None = None
        self.entries_stage = "source-copy"
        self.bytes_stage = "source-copy"
        self.allocated_block_bytes_stage: str | None = None
        self.inode_count_stage: str | None = None

    def observe(self, stage: str, entries: int, byte_count: int, *,
                allocated_block_bytes: int | None = None,
                inode_count: int | None = None) -> None:
        if (stage not in HIGH_WATER_STAGES or type(entries) is not int or entries < 0
                or type(byte_count) is not int or byte_count < 0
                or (allocated_block_bytes is not None and
                    (type(allocated_block_bytes) is not int or allocated_block_bytes < 0))
                or (inode_count is not None and (type(inode_count) is not int or inode_count < 0))):
            raise ValueError("resource high-water sample is invalid")
        if entries > self.entries:
            self.entries, self.entries_stage = entries, stage
        if byte_count > self.bytes:
            self.bytes, self.bytes_stage = byte_count, stage
        if (allocated_block_bytes is not None and
                (self.allocated_block_bytes is None or allocated_block_bytes > self.allocated_block_bytes)):
            self.allocated_block_bytes = allocated_block_bytes
            self.allocated_block_bytes_stage = stage
        if inode_count is not None and (self.inode_count is None or inode_count > self.inode_count):
            self.inode_count = inode_count
            self.inode_count_stage = stage

    def report(self) -> dict[str, object]:
        return {
            "kind": "sampled-high-water-lower-bound",
            "logical_file_bytes": self.bytes,
            "logical_file_bytes_stage": self.bytes_stage,
            "entries": self.entries,
            "entries_stage": self.entries_stage,
            "sampling": "1s subprocess polls plus exact logical-byte accounting during snapshot copy",
            "transient_files_between_samples": "may be missed",
            "allocated_block_bytes": self.allocated_block_bytes,
            "allocated_block_bytes_stage": self.allocated_block_bytes_stage,
            "allocated_block_bytes_status": (
                "sampled-unique-inode-st_blocks-512-byte-units; not-physical-filesystem-usage; "
                "excludes-filesystem-metadata-and-may-miss-transients"
                if self.allocated_block_bytes is not None else "not-measured"
            ),
            "inode_count": self.inode_count,
            "inode_count_stage": self.inode_count_stage,
            "inode_count_status": (
                "sampled-lower-bound-of-unique-tree-inodes-including-root"
                if self.inode_count is not None else "not-measured"
            ),
        }


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
                             live_sample: bool = False,
                             observe_usage: Callable[[int, int, int | None, int], None] | None = None
                             ) -> tuple[int, int]:
    try:
        root_info = root.lstat()
    except FileNotFoundError as exc:
        raise RuntimeError("experiment resource root disappeared") from exc
    if not stat.S_ISDIR(root_info.st_mode) or root.is_symlink():
        raise RuntimeError("experiment resource root is unsafe")
    root_identity = (root_info.st_dev, root_info.st_ino)
    allocated_blocks_known = hasattr(root_info, "st_blocks")
    allocated_block_bytes = getattr(root_info, "st_blocks", 0) * 512
    unique_inode_count = 1
    seen_linked_inodes = {(root_info.st_dev, root_info.st_ino)} if root_info.st_nlink > 1 else set()

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
                    identity = (info.st_dev, info.st_ino)
                    is_new_inode = True
                    if info.st_nlink > 1:
                        if identity in seen_linked_inodes:
                            is_new_inode = False
                        else:
                            seen_linked_inodes.add(identity)
                    if is_new_inode:
                        unique_inode_count += 1
                        if hasattr(info, "st_blocks"):
                            allocated_block_bytes += info.st_blocks * 512
                        else:
                            allocated_blocks_known = False
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
    if observe_usage is not None:
        observe_usage(count, total,
                      allocated_block_bytes if allocated_blocks_known else None,
                      unique_inode_count)
    return count, total


def copy_verified_policy_cache(seed: Path, destination: Path, *, max_entries: int,
                               max_bytes: int) -> str:
    """Make a bounded mutable pnpm cache from the immutable receipt-bound seed."""
    from worker_release_dependency_artifacts import copy_source_tree
    from worker_release_dependency_policy_cache import _hash_tree

    before = seed.lstat()
    identity = (before.st_dev, before.st_ino)
    seed_digest = _hash_tree(seed, max_bytes=max_bytes)
    after = seed.lstat()
    if ((after.st_dev, after.st_ino) != identity or after.st_mtime_ns != before.st_mtime_ns
            or after.st_ctime_ns != before.st_ctime_ns):
        raise RuntimeError("receipt-bound policy cache seed changed before copy")
    copy_source_tree(seed, destination, max_bytes=max_bytes, max_entries=max_entries,
                     preserve_executable=True, expected_root_identity=identity)
    copied_digest = _hash_tree(destination, max_bytes=max_bytes)
    if not hmac.compare_digest(seed_digest, copied_digest):
        raise RuntimeError("mutable pnpm cache snapshot differs from verified seed")
    return copied_digest


def make_policy_cache_seed_read_only(seed: Path) -> None:
    """Reject aliased inodes before chmod changes any cache file metadata."""
    from worker_release_dependency_artifacts import make_read_only_input

    root_info = seed.lstat()
    if not stat.S_ISDIR(root_info.st_mode) or seed.is_symlink():
        raise RuntimeError("receipt-bound policy cache seed is unsafe")
    for current, directories, files in os.walk(seed, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in directories:
            info = (current_path / name).lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise RuntimeError("receipt-bound policy cache seed contains a link or special entry")
        for name in files:
            info = (current_path / name).lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise RuntimeError("receipt-bound policy cache seed contains an aliased file inode")
    make_read_only_input(seed)


__all__ = ["MAX_TREE_BYTES", "MAX_TREE_ENTRIES", "MIN_FREE_BYTES", "MIN_FREE_INODES",
           "HIGH_WATER_STAGES", "ResourceEntryLimitExceeded", "ResourceHighWater",
           "copy_verified_policy_cache", "enforce_resource_limits",
           "make_policy_cache_seed_read_only"]
