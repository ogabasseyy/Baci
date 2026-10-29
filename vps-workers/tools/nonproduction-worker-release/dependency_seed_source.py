"""Validation for an immutable, root-owned Git archive source snapshot."""
from __future__ import annotations

import os
import stat

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_tree import tree_digest_fd

MAX_SOURCE_ENTRIES = 500_000
MAX_SOURCE_BYTES = 512 * 1024 * 1024


def validate_source_tree(source_fd: int) -> tuple[int, int]:
    root = os.fstat(source_fd)
    if (not stat.S_ISDIR(root.st_mode) or root.st_uid != 0
            or root.st_mode & 0o222):
        raise BuilderRejected("dependency source must be root-owned and read-only")
    counts = {"entries": 0, "bytes": 0}

    def visit(fd: int) -> None:
        before = os.fstat(fd)
        for name in sorted(os.listdir(fd)):
            if not name or name in {".", ".."} or "/" in name or "\\" in name:
                raise BuilderRejected("dependency source contains an unsafe name")
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            counts["entries"] += 1
            if (counts["entries"] > MAX_SOURCE_ENTRIES or info.st_uid != 0
                    or info.st_mode & 0o222):
                raise BuilderRejected("dependency source entry is writable, foreign-owned, or over bound")
            if stat.S_ISDIR(info.st_mode):
                child = os.open(name, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                                | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
                try:
                    opened = os.fstat(child)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("dependency source directory changed")
                    visit(child)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
                try:
                    opened = os.fstat(file_fd)
                    if (info.st_dev, info.st_ino, info.st_size) != (
                            opened.st_dev, opened.st_ino, opened.st_size):
                        raise BuilderRejected("dependency source file changed")
                    counts["bytes"] += opened.st_size
                    if counts["bytes"] > MAX_SOURCE_BYTES:
                        raise BuilderRejected("dependency source exceeds byte limit")
                    after_file = os.fstat(file_fd)
                    if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
                            after_file.st_size, after_file.st_mtime_ns, after_file.st_ctime_ns):
                        raise BuilderRejected("dependency source file changed")
                finally:
                    os.close(file_fd)
            else:
                raise BuilderRejected("dependency source contains a link or special file")
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise BuilderRejected("dependency source directory changed")

    visit(source_fd)
    return counts["entries"], counts["bytes"]


def source_snapshot_digest(source_fd: int) -> str:
    validate_source_tree(source_fd)
    return tree_digest_fd(source_fd, max_bytes=MAX_SOURCE_BYTES, owner_uid=0)
