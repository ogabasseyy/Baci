"""Aggregate immutable seed capacity preflight and measured accounting."""
from __future__ import annotations

import os
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import child_directory
from dependency_seed_tree import measure_frozen_tree, tree_usage_fd
from dependency_seed_transaction import JOURNAL, SHA_RE

MAX_SEED_ROOT_BYTES = 16 * 1024 * 1024 * 1024
MAX_SEED_ROOT_ENTRIES = 500_000
MANIFEST_RESERVE_BYTES = 32_768
FREE_SPACE_RESERVE_BYTES = 512 * 1024 * 1024
FREE_INODE_RESERVE = 256


def check_copy_capacity(root_fd: int, *, next_bytes: int = 0,
                        next_inodes: int = 0) -> None:
    """Preserve a live free-space/inode reserve during bounded copying."""
    try:
        capacity = os.fstatvfs(root_fd)
        available_bytes = capacity.f_bavail * capacity.f_frsize
        available_inodes = capacity.f_favail
    except (AttributeError, OSError) as exc:
        raise BuilderRejected("seed root free capacity is unavailable") from exc
    if (available_bytes < next_bytes + FREE_SPACE_RESERVE_BYTES
            or available_inodes < next_inodes + FREE_INODE_RESERVE):
        raise BuilderRejected("seed root free capacity reserve is insufficient")


def seed_root_usage(root_fd: int, *, max_root_bytes: int = MAX_SEED_ROOT_BYTES,
                    max_root_entries: int = MAX_SEED_ROOT_ENTRIES,
                    exclude_names: frozenset[str] = frozenset()) -> tuple[int, int]:
    entries = total_bytes = 0
    for name in os.listdir(root_fd):
        if name in {".publish.lock", JOURNAL}:
            continue
        if name in exclude_names:
            continue
        if not SHA_RE.fullmatch(name):
            raise BuilderRejected("seed root contains an unknown entry")
        seed_fd = child_directory(root_fd, name, owner_uid=os.geteuid(), immutable=True)
        try:
            count, size = measure_frozen_tree(
                seed_fd, owner_uid=os.geteuid(),
                max_entries=max_root_entries - entries,
                max_bytes=max_root_bytes - total_bytes,
            )
        finally:
            os.close(seed_fd)
        entries += count + 1  # Include the canonical seed directory inode.
        total_bytes += size
        if entries > max_root_entries or total_bytes > max_root_bytes:
            raise BuilderRejected("seed root exceeds aggregate quota")
    return entries, total_bytes


def preflight_copy_budget(root_fd: int, cache_fd: int, store_fd: int, *,
                          max_cache_bytes: int, max_store_bytes: int,
                          max_root_bytes: int = MAX_SEED_ROOT_BYTES,
                          max_root_entries: int = MAX_SEED_ROOT_ENTRIES) -> dict[str, int]:
    existing_entries, existing_bytes = seed_root_usage(
        root_fd, max_root_bytes=max_root_bytes, max_root_entries=max_root_entries)
    cache_entries, cache_bytes = tree_usage_fd(
        cache_fd, max_bytes=max_cache_bytes, max_entries=100_000,
    )
    store_entries, store_bytes = tree_usage_fd(
        store_fd, max_bytes=max_store_bytes, max_entries=200_000,
    )
    add_entries = cache_entries + store_entries + 4  # cache, store, manifest, staging root
    add_bytes = cache_bytes + store_bytes + MANIFEST_RESERVE_BYTES
    if (existing_entries + add_entries > max_root_entries
            or existing_bytes + add_bytes > max_root_bytes):
        raise BuilderRejected("seed root exceeds aggregate quota")
    check_copy_capacity(root_fd, next_bytes=add_bytes, next_inodes=add_entries)
    return {
        "bytes": existing_bytes + MANIFEST_RESERVE_BYTES,
        "entries": existing_entries + 4,
        "max_bytes": max_root_bytes,
        "max_entries": max_root_entries,
        "cache_bytes": cache_bytes,
        "store_bytes": store_bytes,
    }
