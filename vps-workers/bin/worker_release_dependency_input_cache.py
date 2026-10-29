"""Bounded validation and private copying for the pnpm input caches."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, copy_source_tree, make_read_only_input
from worker_release_dependency_evidence_shape import OFFLINE_STORE_SUBTYPES
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES, MAX_CACHE_ENTRIES, RECEIPT_NAME, _hash_tree


class OfflineStoreRejected(BuilderRejected):
    def __init__(self, message: str, safe_subtype: str):
        self.safe_subtype = safe_subtype if safe_subtype in OFFLINE_STORE_SUBTYPES else None
        super().__init__(message)


def validate_offline_store(
    store: Path,
    *,
    owner_uid: int,
    max_entries: int,
    max_bytes: int,
) -> tuple[tuple[int, int], frozenset[str]]:
    try:
        info = store.lstat()
    except OSError as exc:
        raise OfflineStoreRejected("fixed offline pnpm store is unavailable", "root-unavailable") from exc
    if not stat.S_ISDIR(info.st_mode):
        raise OfflineStoreRejected("fixed offline pnpm store ownership or mode is unsafe", "root-type")
    if info.st_uid != owner_uid or info.st_mode & 0o022:
        raise OfflineStoreRejected("fixed offline pnpm store ownership or mode is unsafe", "root-owner-mode")
    root_identity = (info.st_dev, info.st_ino)
    entries = 0
    total_bytes = 0
    excluded_project_indexes: set[str] = set()
    for current, directories, files in os.walk(store, topdown=True, followlinks=False):
        relative_parent = Path(current).relative_to(store).parts
        for name in list(directories):
            path = Path(current) / name
            child = path.lstat()
            entries += 1
            if entries > max_entries:
                raise OfflineStoreRejected("offline pnpm store has too many entries", "entry-count-limit")
            if stat.S_ISLNK(child.st_mode):
                raise OfflineStoreRejected("offline pnpm store contains a symlink or special file", "entry-symlink")
            if stat.S_ISDIR(child.st_mode):
                if child.st_uid != owner_uid or child.st_mode & 0o022:
                    raise OfflineStoreRejected("offline pnpm store contains an untrusted entry", "entry-owner-mode")
                relative = "/".join((*relative_parent, name))
                if (len(relative_parent) == 1 and re.fullmatch(r"v[0-9]+", relative_parent[0])
                        and name == "projects"):
                    excluded_project_indexes.add(relative)
                    directories.remove(name)
                continue
            raise OfflineStoreRejected("offline pnpm store contains a symlink or special file", "entry-special")
        for name in files:
            path = Path(current) / name
            child = path.lstat()
            entries += 1
            if entries > max_entries:
                raise OfflineStoreRejected("offline pnpm store has too many entries", "entry-count-limit")
            if stat.S_ISLNK(child.st_mode):
                raise OfflineStoreRejected("offline pnpm store contains a symlink or special file", "entry-symlink")
            if not stat.S_ISREG(child.st_mode):
                raise OfflineStoreRejected("offline pnpm store contains a symlink or special file", "entry-special")
            if child.st_uid != owner_uid or child.st_mode & 0o022:
                raise OfflineStoreRejected("offline pnpm store contains an untrusted entry", "entry-owner-mode")
            if child.st_nlink < 1:
                raise OfflineStoreRejected("offline pnpm store contains an untrusted entry", "entry-owner-mode")
            total_bytes += child.st_size
            if total_bytes > max_bytes:
                raise OfflineStoreRejected("offline pnpm store exceeds the private-copy size limit",
                                           "entry-size-limit")
    try:
        after = store.lstat()
    except OSError as exc:
        raise OfflineStoreRejected("fixed offline pnpm store changed during validation", "root-changed") from exc
    if ((after.st_dev, after.st_ino) != root_identity
            or after.st_mtime_ns != info.st_mtime_ns or after.st_ctime_ns != info.st_ctime_ns):
        raise OfflineStoreRejected("fixed offline pnpm store changed during validation", "root-changed")
    return root_identity, frozenset(excluded_project_indexes)


def copy_private_offline_store(
    store: Path,
    scratch: Path,
    uid: int,
    gid: int,
    root_identity: tuple[int, int],
    excluded_project_indexes: frozenset[str],
    *,
    max_entries: int,
    max_bytes: int,
) -> Path:
    destination = scratch / "pnpm-store"
    copy_source_tree(store, destination, max_bytes=max_bytes, max_entries=max_entries,
                     preserve_executable=True, allow_hardlinks=True,
                     exclude_relative_directories=excluded_project_indexes,
                     expected_root_identity=root_identity)
    _make_private_writable(destination, uid, gid, store_label="offline pnpm store")
    return destination


def copy_private_policy_cache(
    cache: Path,
    scratch: Path,
    uid: int,
    gid: int,
    *,
    max_entries: int = MAX_CACHE_ENTRIES,
    max_bytes: int = MAX_CACHE_BYTES,
) -> Path:
    try:
        before = cache.lstat()
    except OSError as exc:
        raise BuilderRejected("fixed pnpm policy cache is unavailable") from exc
    identity = (before.st_dev, before.st_ino)
    _hash_tree(cache)
    after = cache.lstat()
    if ((after.st_dev, after.st_ino) != identity or after.st_mtime_ns != before.st_mtime_ns
            or after.st_ctime_ns != before.st_ctime_ns):
        raise BuilderRejected("fixed pnpm policy cache changed before private copy")
    destination = scratch / "pnpm-cache"
    copy_source_tree(cache, destination, max_bytes=max_bytes, max_entries=max_entries,
                     preserve_executable=True, allow_hardlinks=True,
                     expected_root_identity=identity)
    _make_private_writable(destination, uid, gid, store_label="pnpm policy cache")
    return destination


def copy_policy_cache_seed(
    cache: Path,
    receipt_source: Path,
    input_root: Path,
    *,
    max_entries: int = MAX_CACHE_ENTRIES,
    max_bytes: int = MAX_CACHE_BYTES,
) -> Path:
    """Create a root-owned read-only metadata seed and sibling receipt."""
    seed = input_root / "pnpm-cache-seed"
    copy_source_tree(cache, seed, max_bytes=max_bytes, max_entries=max_entries)
    _copy_seed_receipt(receipt_source, input_root)
    make_read_only_input(seed)
    return seed


def _copy_seed_receipt(receipt_source: Path, input_root: Path) -> None:
    if receipt_source.name != RECEIPT_NAME:
        raise BuilderRejected("fixed pnpm policy receipt name is unexpected")
    try:
        source_fd = os.open(receipt_source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("fixed pnpm policy receipt is unavailable") from exc
    destination_parent_fd = -1
    destination_fd = -1
    created = False
    try:
        destination_parent_fd = os.open(
            input_root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        )
        parent_info = os.fstat(destination_parent_fd)
        if (not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != 0
                or parent_info.st_mode & 0o022):
            raise BuilderRejected("policy seed parent ownership or mode is unsafe")
        before = os.fstat(source_fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1
                or before.st_mode & 0o022 or before.st_size > 32_768):
            raise BuilderRejected("fixed pnpm policy receipt inode is unsafe")
        destination_fd = os.open(RECEIPT_NAME,
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | getattr(os, "O_NOFOLLOW", 0), 0o444,
                                 dir_fd=destination_parent_fd)
        created = True
        copied = 0
        while chunk := os.read(source_fd, min(16_384, 32_769 - copied)):
            copied += len(chunk)
            if copied > 32_768:
                raise BuilderRejected("fixed pnpm policy receipt exceeds its size limit")
            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise BuilderRejected("pnpm policy receipt snapshot write failed")
                view = view[written:]
        after = os.fstat(source_fd)
        if (copied != before.st_size or
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
            raise BuilderRejected("fixed pnpm policy receipt changed while copying")
        os.fsync(destination_fd)
        os.fsync(destination_parent_fd)
    except BaseException:
        if destination_fd >= 0:
            os.close(destination_fd)
            destination_fd = -1
        try:
            if created and destination_parent_fd >= 0:
                os.unlink(RECEIPT_NAME, dir_fd=destination_parent_fd)
        except FileNotFoundError:
            pass
        raise
    finally:
        if destination_fd >= 0:
            os.close(destination_fd)
        if destination_parent_fd >= 0:
            os.close(destination_parent_fd)
        os.close(source_fd)


def _make_private_writable(destination: Path, uid: int, gid: int, *, store_label: str) -> None:
    for current, directories, files in os.walk(destination, topdown=False, followlinks=False):
        current_path = Path(current)
        for name in files:
            path = current_path / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise BuilderRejected(f"private {store_label} contains an unsafe file")
            os.chown(path, uid, gid, follow_symlinks=False)
            os.chmod(path, 0o700 if store_label == "offline pnpm store" and info.st_mode & 0o111 else 0o600,
                     follow_symlinks=False)
        for name in directories:
            path = current_path / name
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise BuilderRejected(f"private {store_label} contains an unsafe directory")
            os.chown(path, uid, gid, follow_symlinks=False)
            os.chmod(path, 0o700, follow_symlinks=False)
        os.chown(current_path, uid, gid, follow_symlinks=False)
        os.chmod(current_path, 0o700, follow_symlinks=False)
