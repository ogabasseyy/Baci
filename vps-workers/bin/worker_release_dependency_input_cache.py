"""Bounded validation and private copying for the pnpm input caches."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, copy_source_tree
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES, MAX_CACHE_ENTRIES, _hash_tree


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
        raise BuilderRejected("fixed offline pnpm store is unavailable") from exc
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
        raise BuilderRejected("fixed offline pnpm store ownership or mode is unsafe")
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
                raise BuilderRejected("offline pnpm store has too many entries")
            if child.st_uid != owner_uid or child.st_mode & 0o022:
                raise BuilderRejected("offline pnpm store contains an untrusted entry")
            if stat.S_ISDIR(child.st_mode):
                relative = "/".join((*relative_parent, name))
                if (len(relative_parent) == 1 and re.fullmatch(r"v[0-9]+", relative_parent[0])
                        and name == "projects"):
                    excluded_project_indexes.add(relative)
                    directories.remove(name)
                continue
            raise BuilderRejected("offline pnpm store contains a symlink or special file")
        for name in files:
            path = Path(current) / name
            child = path.lstat()
            entries += 1
            if entries > max_entries:
                raise BuilderRejected("offline pnpm store has too many entries")
            if child.st_uid != owner_uid or child.st_mode & 0o022:
                raise BuilderRejected("offline pnpm store contains an untrusted entry")
            if not stat.S_ISREG(child.st_mode) or child.st_nlink < 1:
                raise BuilderRejected("offline pnpm store contains a symlink or special file")
            total_bytes += child.st_size
            if total_bytes > max_bytes:
                raise BuilderRejected("offline pnpm store exceeds the private-copy size limit")
    try:
        after = store.lstat()
    except OSError as exc:
        raise BuilderRejected("fixed offline pnpm store changed during validation") from exc
    if ((after.st_dev, after.st_ino) != root_identity
            or after.st_mtime_ns != info.st_mtime_ns or after.st_ctime_ns != info.st_ctime_ns):
        raise BuilderRejected("fixed offline pnpm store changed during validation")
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
