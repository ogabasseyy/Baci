"""Bridge generation-resource recovery to the immutable seed publisher journal."""
from __future__ import annotations

import os
import stat
from contextlib import ExitStack
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import child_directory, open_directory
from dependency_seed_recovery import recover_interrupted_seed
from dependency_seed_transaction import (
    JOURNAL, existing_seed_lock, read_inflight_journal,
)
from dependency_seed_verification import verify_seed_locked


def recover_seed_publication(seed_root: Path, source: Path, source_sha: str,
                             transaction_id: str, scratch: Path,
                             record: dict[str, object], *, max_cache_bytes: int,
                             max_store_bytes: int) -> bool:
    """Recover only the exact transaction's in-flight same-filesystem move."""
    with ExitStack() as stack:
        source_fd = stack.enter_context(_FdContext(open_directory(source, owner_uid=0, immutable=True)))
        root_fd, lock_fd = existing_seed_lock(seed_root)
        stack.callback(os.close, root_fd)
        stack.callback(os.close, lock_fd)
        scratch_fd = -1
        try:
            info = os.stat(scratch, follow_symlinks=False)
        except FileNotFoundError:
            info = None
        if info is not None:
            scratch_fd = open_directory(scratch, owner_uid=0)
            stack.callback(os.close, scratch_fd)
            opened = os.fstat(scratch_fd)
            if ((opened.st_dev, opened.st_ino) != (record.get("scratch_dev"), record.get("scratch_ino"))
                    or not stat.S_ISDIR(info.st_mode)):
                raise BuilderRejected("seed publication scratch differs from generation journal")
        if JOURNAL in os.listdir(root_fd):
            journal, journal_fd = read_inflight_journal(root_fd)
            os.close(journal_fd)
            if (journal.get("sourceSha") != source_sha
                    or journal.get("stagingName") != f".{source_sha}.{transaction_id}"
                    or journal.get("moveInputs") is None or scratch_fd < 0):
                raise BuilderRejected("seed publisher journal differs from generation transaction")
            move = journal["moveInputs"]
            scratch_info = os.fstat(scratch_fd)
            if (move.get("parentDevice"), move.get("parentInode")) != (
                    scratch_info.st_dev, scratch_info.st_ino):
                raise BuilderRejected("seed publisher input parent differs from generation journal")
            for name in ("cache", "store"):
                if (move.get(f"{name}Device"), move.get(f"{name}Inode")) != (
                        record.get(f"{name}_dev"), record.get(f"{name}_ino")):
                    raise BuilderRejected("seed publisher input inode differs from generation journal")
            return recover_interrupted_seed(
                root_fd, lock_fd, source_fd, source_sha,
                max_cache_bytes=max_cache_bytes, max_store_bytes=max_store_bytes,
                move_source_parent_fd=scratch_fd,
            )
        try:
            target = os.stat(source_sha, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            target = None
        if target is None:
            if scratch_fd < 0:
                raise BuilderRejected("seed inputs and publication target are both absent")
            for name in ("cache", "store"):
                expected = (record.get(f"{name}_dev"), record.get(f"{name}_ino"))
                info = os.stat(name, dir_fd=scratch_fd, follow_symlinks=False)
                if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != expected:
                    raise BuilderRejected("seed input disappeared without a publisher journal")
            return False
        if not stat.S_ISDIR(target.st_mode) or target.st_uid != 0:
            raise BuilderRejected("existing seed publication target is unsafe")
        verify_seed_locked(root_fd, source_fd, source_sha,
                           max_cache_bytes=max_cache_bytes, max_store_bytes=max_store_bytes)
        seed_fd = child_directory(root_fd, source_sha, owner_uid=0, immutable=True)
        try:
            moved = True
            for name, key in (("cache", "cache"), ("store", "store")):
                expected = (record.get(f"{key}_dev"), record.get(f"{key}_ino"))
                try:
                    info = os.stat(name, dir_fd=seed_fd, follow_symlinks=False)
                except FileNotFoundError:
                    moved = False
                    continue
                if (not stat.S_ISDIR(info.st_mode)
                        or (info.st_dev, info.st_ino) != expected):
                    moved = False
            return moved
        finally:
            os.close(seed_fd)


class _FdContext:
    def __init__(self, fd: int):
        self.fd = fd

    def __enter__(self) -> int:
        return self.fd

    def __exit__(self, *_exc) -> None:
        os.close(self.fd)
