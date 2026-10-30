"""No-copy same-filesystem seed staging helpers."""
from __future__ import annotations

import os
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import assert_frozen_tree, child_directory
from dependency_seed_publication import move_input_directory, open_move_source_parent
from dependency_seed_capacity import (
    MAX_SEED_ROOT_BYTES, MAX_SEED_ROOT_ENTRIES, check_copy_capacity,
    seed_root_usage,
)
from dependency_seed_tree import measure_frozen_tree

MAX_STORE_ENTRIES = 200_000
MAX_CACHE_ENTRIES = 100_000
MANIFEST_RESERVE = 32_768


def pin_and_preflight(cache: Path, store: Path, cache_fd: int, store_fd: int,
                      root_fd: int, transaction_id: str, *,
                      max_cache_bytes: int, max_store_bytes: int) -> tuple[int, dict[str, int]]:
    if (not isinstance(transaction_id, str) or len(transaction_id) != 32
            or any(char not in "0123456789abcdef" for char in transaction_id)):
        raise BuilderRejected("same-filesystem publication transaction is invalid")
    owner = os.geteuid()
    assert_frozen_tree(cache_fd, owner_uid=owner)
    assert_frozen_tree(store_fd, owner_uid=owner)
    parent_fd, identities = open_move_source_parent(cache, store, cache_fd, store_fd, root_fd)
    try:
        existing_entries, existing_bytes = seed_root_usage(
            root_fd, max_root_bytes=MAX_SEED_ROOT_BYTES,
            max_root_entries=MAX_SEED_ROOT_ENTRIES,
        )
        cache_entries, cache_bytes = measure_frozen_tree(
            cache_fd, owner_uid=owner, max_entries=MAX_CACHE_ENTRIES,
            max_bytes=max_cache_bytes,
        )
        store_entries, store_bytes = measure_frozen_tree(
            store_fd, owner_uid=owner, max_entries=MAX_STORE_ENTRIES,
            max_bytes=max_store_bytes,
        )
        if (existing_entries + cache_entries + store_entries + 4 > MAX_SEED_ROOT_ENTRIES
                or existing_bytes + cache_bytes + store_bytes + MANIFEST_RESERVE > MAX_SEED_ROOT_BYTES):
            raise BuilderRejected("seed root exceeds aggregate quota")
        check_copy_capacity(root_fd, next_bytes=MANIFEST_RESERVE, next_inodes=4)
        return parent_fd, identities
    except BaseException:
        os.close(parent_fd)
        raise


def transfer_inputs(source_parent_fd: int, staging_fd: int,
                    identities: dict[str, int], *, owner_uid: int) -> tuple[int, int]:
    for name in ("cache", "store"):
        move_input_directory(source_parent_fd, staging_fd, name,
                             (identities[f"{name}Device"], identities[f"{name}Inode"]))
    cache_fd = child_directory(staging_fd, "cache", owner_uid=owner_uid)
    try:
        store_fd = child_directory(staging_fd, "store", owner_uid=owner_uid)
    except BaseException:
        os.close(cache_fd)
        raise
    return cache_fd, store_fd
