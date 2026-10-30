"""Descriptor-anchored scratch directory setup for seed generation."""
from __future__ import annotations

import os
import stat
import time
from pathlib import Path

from dependency_seed_generation_contract import SeedGenerationRejected


def create_seed_scratch(workspace: Path, transaction_id: str, journal,
                        builder_uid: int, builder_gid: int) -> tuple[Path, Path, Path]:
    """Create root journaled work dirs; persist every inode before worker access."""
    if (len(transaction_id) != 32
            or any(char not in "0123456789abcdef" for char in transaction_id)):
        raise SeedGenerationRejected("seed transaction id is malformed")
    workspace_fd = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root_info = os.fstat(workspace_fd)
        if (root_info.st_uid != 0 or stat.S_IMODE(root_info.st_mode) != 0o700):
            raise SeedGenerationRejected("seed workspace ownership or mode is unsafe")
        name = f"seed-{transaction_id}"
        os.mkdir(name, 0o700, dir_fd=workspace_fd)
        os.fsync(workspace_fd)
        scratch_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=workspace_fd)
        try:
            scratch = os.fstat(scratch_fd)
            if scratch.st_uid != 0 or stat.S_IMODE(scratch.st_mode) != 0o700:
                raise SeedGenerationRejected("seed scratch directory is unsafe")
            journal.mark_scratch_created((scratch.st_dev, scratch.st_ino))
            os.mkdir("cache", 0o700, dir_fd=scratch_fd)
            os.mkdir("store", 0o700, dir_fd=scratch_fd)
            os.fsync(scratch_fd)
            cache_fd = os.open("cache", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=scratch_fd)
            store_fd = os.open("store", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=scratch_fd)
            try:
                cache_info, store_info = os.fstat(cache_fd), os.fstat(store_fd)
                journal.mark_outputs_created((cache_info.st_dev, cache_info.st_ino),
                                             (store_info.st_dev, store_info.st_ino))
                os.fchown(cache_fd, builder_uid, builder_gid)
                os.fchown(store_fd, builder_uid, builder_gid)
                os.fchmod(cache_fd, 0o700)
                os.fchmod(store_fd, 0o700)
                os.fsync(cache_fd)
                os.fsync(store_fd)
                os.fsync(scratch_fd)
                return (Path(workspace) / name, Path(workspace) / name / "cache",
                        Path(workspace) / name / "store")
            finally:
                os.close(cache_fd)
                os.close(store_fd)
        finally:
            os.close(scratch_fd)
    finally:
        os.close(workspace_fd)


def remove_seed_scratch(workspace: Path, scratch_name: str,
                        expected_scratch: tuple[int, int],
                        expected_cache: tuple[int, int], expected_store: tuple[int, int], *,
                        outputs_moved: bool = False) -> None:
    """Remove only frozen root-owned outputs and the exact scratch inode."""
    root_fd = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(root_fd)
        if root.st_uid != 0 or stat.S_IMODE(root.st_mode) != 0o700:
            raise SeedGenerationRejected("seed workspace changed before cleanup")
        scratch_fd = os.open(scratch_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=root_fd)
        try:
            scratch = os.fstat(scratch_fd)
            if (scratch.st_dev, scratch.st_ino) != expected_scratch or scratch.st_uid != 0:
                raise SeedGenerationRejected("seed scratch inode changed before cleanup")
            for name, expected in (("cache", expected_cache), ("store", expected_store)):
                try:
                    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=scratch_fd)
                except FileNotFoundError:
                    if outputs_moved:
                        continue
                    raise SeedGenerationRejected("seed output disappeared before cleanup")
                try:
                    info = os.fstat(fd)
                    if (info.st_dev, info.st_ino) != expected or info.st_uid != 0:
                        raise SeedGenerationRejected("seed output inode changed before cleanup")
                finally:
                    os.close(fd)
                _remove_root_owned_tree(scratch_fd, name, expected)
            if os.listdir(scratch_fd):
                raise SeedGenerationRejected("seed scratch contains unjournaled entries")
        finally:
            os.close(scratch_fd)
        os.rmdir(scratch_name, dir_fd=root_fd)
        os.fsync(root_fd)
    finally:
        os.close(root_fd)


def recover_seed_scratch(workspace: Path, record: dict[str, object], *,
                         builder_uid: int, builder_gid: int,
                         max_bytes: int, max_entries: int,
                         max_seconds: float = 120) -> None:
    """After unit quiescence, remove only the journal-named scratch inode."""
    if record.get("scratch_name") != f"seed-{record.get('transaction_id')}":
        raise SeedGenerationRejected("seed scratch name is not transaction-derived")
    root_fd = os.open(workspace, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(root_fd)
        if ((root.st_dev, root.st_ino) != (record.get("scratch_root_dev"),
                                           record.get("scratch_root_ino"))
                or root.st_uid != 0 or stat.S_IMODE(root.st_mode) != 0o700):
            raise SeedGenerationRejected("seed workspace identity changed during recovery")
        name = record["scratch_name"]
        try:
            scratch_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                 dir_fd=root_fd)
        except FileNotFoundError:
            return
        try:
            deadline = time.monotonic() + max_seconds
            scratch = os.fstat(scratch_fd)
            expected_scratch = record.get("scratch_dev"), record.get("scratch_ino")
            if (scratch.st_uid != 0 or stat.S_IMODE(scratch.st_mode) != 0o700
                    or (expected_scratch != (None, None)
                        and (scratch.st_dev, scratch.st_ino) != expected_scratch)):
                raise SeedGenerationRejected("seed scratch inode changed during recovery")
            for kind in ("cache", "store"):
                _recover_output(scratch_fd, kind, record, builder_uid=builder_uid,
                                builder_gid=builder_gid, max_bytes=max_bytes,
                                max_entries=max_entries, deadline=deadline)
            if os.listdir(scratch_fd):
                raise SeedGenerationRejected("seed scratch contains unjournaled entries")
        finally:
            os.close(scratch_fd)
        os.rmdir(name, dir_fd=root_fd)
        os.fsync(root_fd)
    finally:
        os.close(root_fd)


def _recover_output(scratch_fd: int, name: str, record: dict[str, object], *,
                    builder_uid: int, builder_gid: int, max_bytes: int,
                    max_entries: int, deadline: float) -> None:
    expected = record.get(f"{name}_dev"), record.get(f"{name}_ino")
    try:
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=scratch_fd)
    except FileNotFoundError:
        if expected != (None, None):
            # A crash can occur after removal but before the journal update.
            return
        return
    try:
        info = os.fstat(fd)
        if (info.st_uid not in (0, builder_uid) or info.st_gid not in (0, builder_gid)
                or info.st_mode & 0o022):
            raise SeedGenerationRejected("seed output root ownership or mode is unsafe")
        if (expected == (None, None)
                and (info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700
                     or os.listdir(fd))):
            raise SeedGenerationRejected("unrecorded seed output is not an empty private directory")
        if expected != (None, None) and (info.st_dev, info.st_ino) != expected:
            raise SeedGenerationRejected("journaled seed output inode changed")
        _validate_output_tree(fd, builder_uid, builder_gid, max_bytes, max_entries, deadline)
    finally:
        os.close(fd)
    _remove_root_owned_tree(scratch_fd, name, expected if expected != (None, None)
                            else (info.st_dev, info.st_ino), owner_uids=(0, builder_uid))


def _validate_output_tree(root_fd: int, builder_uid: int, builder_gid: int,
                          max_bytes: int, max_entries: int, deadline: float) -> None:
    pending = [(os.dup(root_fd), 0)]
    entries = total = 0
    try:
        while pending:
            fd, depth = pending.pop()
            try:
                if time.monotonic() >= deadline:
                    raise SeedGenerationRejected("seed output recovery exceeded its fixed deadline")
                if depth > 128:
                    raise SeedGenerationRejected("seed output exceeds cleanup depth")
                for name in os.listdir(fd):
                    if time.monotonic() >= deadline:
                        raise SeedGenerationRejected("seed output recovery exceeded its fixed deadline")
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    entries += 1
                    total += info.st_size
                    if (entries > max_entries or total > max_bytes
                            or info.st_uid not in (0, builder_uid)
                            or info.st_gid not in (0, builder_gid) or info.st_mode & 0o022):
                        raise SeedGenerationRejected("seed output exceeds recovery bounds")
                    if stat.S_ISDIR(info.st_mode):
                        child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                        dir_fd=fd)
                        opened = os.fstat(child)
                        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                            os.close(child)
                            raise SeedGenerationRejected("seed output changed during recovery")
                        pending.append((child, depth + 1))
                    elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                        file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
                        try:
                            opened = os.fstat(file_fd)
                            if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                                raise SeedGenerationRejected("seed output file changed during recovery")
                        finally:
                            os.close(file_fd)
                    elif not stat.S_ISLNK(info.st_mode):
                        raise SeedGenerationRejected("seed output contains a link or special file")
            finally:
                os.close(fd)
    finally:
        for fd, _depth in pending:
            os.close(fd)


def _remove_root_owned_tree(parent_fd: int, name: str, expected: tuple[int, int],
                            *, owner_uids: tuple[int, ...] = (0,)) -> None:
    import shutil
    if not shutil.rmtree.avoids_symlink_attacks:
        raise SeedGenerationRejected("safe seed scratch cleanup is unavailable")
    fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        info = os.fstat(fd)
        if (info.st_dev, info.st_ino) != expected or info.st_uid not in owner_uids:
            raise SeedGenerationRejected("seed cleanup directory changed")
    finally:
        os.close(fd)
    shutil.rmtree(name, dir_fd=parent_fd)
    os.fsync(parent_fd)


__all__ = ["create_seed_scratch", "remove_seed_scratch"]
