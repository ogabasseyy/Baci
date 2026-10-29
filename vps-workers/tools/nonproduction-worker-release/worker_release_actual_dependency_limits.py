"""Payload bounds scoped to the disposable dependency experiment only."""
from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

import worker_release_dependency_artifacts as artifacts
import worker_release_dependency_fs as dependency_fs
import worker_release_dependency_install as installer
from worker_release_actual_dependency_resources import MAX_TREE_BYTES

EXPERIMENT_PAYLOAD_BYTES = MAX_TREE_BYTES
MAX_DIAGNOSTIC_ENTRIES = installer.MAX_MATERIALIZED_ENTRIES


def inspect_materialization_budget(payload: Path, *, byte_limit: int) -> tuple[str, int, int]:
    """Boundedly estimate regular-file materialization without exposing paths."""
    root = payload.resolve(strict=True)
    entries = 0
    expanded_bytes = 0
    entry_limit = MAX_DIAGNOSTIC_ENTRIES
    if type(byte_limit) is not int or not 0 <= byte_limit <= EXPERIMENT_PAYLOAD_BYTES:
        raise ValueError("materialization diagnostic byte limit is invalid")

    def add_file(path: Path) -> str | None:
        nonlocal entries, expanded_bytes
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            return "unsafe-entry"
        entries += 1
        expanded_bytes += info.st_size
        if entries > entry_limit and expanded_bytes > byte_limit:
            return "both"
        if entries > entry_limit:
            return "entry-bound"
        if expanded_bytes > byte_limit:
            return "bytes-bound"
        return None

    def walk(path: Path, ancestors: frozenset[tuple[int, int]]) -> str | None:
        nonlocal entries
        resolved = path.resolve(strict=True)
        try:
            resolved.relative_to(root)
        except ValueError:
            return "unsafe-entry"
        info = resolved.lstat()
        if not stat.S_ISDIR(info.st_mode):
            return "unsafe-entry"
        inode = (info.st_dev, info.st_ino)
        if inode in ancestors:
            return "unsafe-entry"
        entries += 1
        if entries > entry_limit:
            return "entry-bound"
        next_ancestors = ancestors | {inode}
        try:
            with os.scandir(resolved) as iterator:
                children = sorted(iterator, key=lambda child: child.name)
        except OSError:
            return "unsafe-entry"
        for child in children:
            source = Path(child.path)
            try:
                child_info = source.lstat()
                if stat.S_ISDIR(child_info.st_mode):
                    result = walk(source, next_ancestors)
                elif stat.S_ISREG(child_info.st_mode):
                    result = add_file(source)
                elif stat.S_ISLNK(child_info.st_mode):
                    target = source.resolve(strict=True)
                    target.relative_to(root)
                    if target.is_dir():
                        result = walk(target, next_ancestors)
                    elif target.is_file():
                        result = add_file(target)
                    else:
                        result = "unsafe-entry"
                else:
                    result = "unsafe-entry"
            except (OSError, ValueError, RuntimeError):
                result = "unsafe-entry"
            if result:
                return result
        return None

    for relative in (Path("web/node_modules"), Path("root/node_modules")):
        source = payload / relative
        try:
            result = walk(source, frozenset())
        except (OSError, ValueError, RuntimeError):
            result = "unsafe-entry"
        if result:
            return result, min(entries, entry_limit + 1), min(expanded_bytes, byte_limit + 1)
    return "within-bounds", entries, expanded_bytes


def reclaim_experiment_tree(path: Path, *, scratch_root: Path) -> None:
    """Remove one experiment-owned scratch child after its phase has ended."""
    path = Path(path)
    scratch_root = Path(scratch_root).resolve(strict=True)
    if path.parent.resolve(strict=True) != scratch_root or path.name not in {
        "source", "pnpm-store", "pnpm-cache", "pnpm-build-cache", "payload", "checkout.tar", "home",
    }:
        raise RuntimeError("experiment scratch reclamation target is invalid")
    info = path.lstat()
    if info.st_uid != os.geteuid():
        raise RuntimeError("experiment scratch reclamation owner is invalid")
    if stat.S_ISDIR(info.st_mode):
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError("safe experiment scratch reclamation is unavailable")
        def restore_owned_directory_permissions(error: OSError) -> None:
            raise RuntimeError("experiment scratch directory cannot be safely inspected") from error

        for current, directories, _files in os.walk(path, topdown=True, followlinks=False,
                                                     onerror=restore_owned_directory_permissions):
            current_path = Path(current)
            fd = os.open(current_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                current_info = os.fstat(fd)
                if not stat.S_ISDIR(current_info.st_mode) or current_info.st_uid != os.geteuid():
                    raise RuntimeError("experiment scratch directory owner is invalid")
                os.fchmod(fd, stat.S_IMODE(current_info.st_mode) | 0o700)
            finally:
                os.close(fd)
            for name in directories:
                child_info = (current_path / name).lstat()
                if stat.S_ISDIR(child_info.st_mode) and child_info.st_uid != os.geteuid():
                    raise RuntimeError("experiment scratch directory owner is invalid")
        shutil.rmtree(path)
    elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
        path.unlink()
    else:
        raise RuntimeError("experiment scratch reclamation target type is invalid")
    if os.path.lexists(path):
        raise RuntimeError("experiment scratch reclamation did not complete")


def configure_experiment_payload_limits(smoke=None, *, materialization_limit: int | None = None) -> None:
    """Raise only this disposable experiment's payload limits under its scratch monitor."""
    artifacts.MAX_PAYLOAD_BYTES = EXPERIMENT_PAYLOAD_BYTES
    dependency_fs.MAX_PAYLOAD_BYTES = EXPERIMENT_PAYLOAD_BYTES
    if materialization_limit is not None:
        if (type(materialization_limit) is not int or materialization_limit < 0
                or materialization_limit > EXPERIMENT_PAYLOAD_BYTES):
            raise RuntimeError("experiment materialization headroom is invalid")
        installer.MAX_MATERIALIZED_BYTES = materialization_limit
    if smoke is not None:
        smoke.MAX_BYTES = EXPERIMENT_PAYLOAD_BYTES
