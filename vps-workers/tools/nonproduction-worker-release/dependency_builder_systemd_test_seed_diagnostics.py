"""Fixed-enum diagnostics for the disposable seed publisher fixture."""
from __future__ import annotations

import os
import stat
from pathlib import Path

MAX_ENTRIES = 200_000
MAX_BYTES = 4 * 1024 * 1024 * 1024
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
ALLOWED = frozenset({
    "valid", "root-unavailable", "root-type", "foreign-owner", "writable-mode",
    "entry-limit", "byte-limit", "symlink", "hardlink", "special-entry", "scan-error",
})


def safe_tree_category(root: Path, *, owner_uid: int = 0) -> str:
    """Return one static reason category; never emit names or source contents."""
    entries = 0
    total_bytes = 0
    try:
        root_fd = os.open(root, DIRECTORY_FLAGS)
    except FileNotFoundError:
        return "root-unavailable"
    except OSError:
        return "scan-error"
    try:
        root_info = os.fstat(root_fd)
        if not stat.S_ISDIR(root_info.st_mode):
            return "root-type"
        if root_info.st_uid != owner_uid:
            return "foreign-owner"
        if root_info.st_mode & 0o022:
            return "writable-mode"

        def visit(directory_fd: int) -> str:
            nonlocal entries, total_bytes
            before = os.fstat(directory_fd)
            for name in sorted(os.listdir(directory_fd)):
                if not name or name in {".", ".."} or "/" in name or "\\" in name:
                    return "scan-error"
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                entries += 1
                if entries > MAX_ENTRIES:
                    return "entry-limit"
                if stat.S_ISLNK(info.st_mode):
                    return "symlink"
                if info.st_uid != owner_uid:
                    return "foreign-owner"
                if info.st_mode & 0o022:
                    return "writable-mode"
                if stat.S_ISDIR(info.st_mode):
                    child_fd = os.open(name, DIRECTORY_FLAGS, dir_fd=directory_fd)
                    try:
                        opened = os.fstat(child_fd)
                        if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                            return "scan-error"
                        category = visit(child_fd)
                        if category != "valid":
                            return category
                    finally:
                        os.close(child_fd)
                elif stat.S_ISREG(info.st_mode):
                    if info.st_nlink != 1:
                        return "hardlink"
                    total_bytes += info.st_size
                    if total_bytes > MAX_BYTES:
                        return "byte-limit"
                elif not stat.S_ISREG(info.st_mode):
                    return "special-entry"
            after = os.fstat(directory_fd)
            if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
                return "scan-error"
            return "valid"

        category = visit(root_fd)
        return category if category in ALLOWED else "scan-error"
    except OSError:
        return "scan-error"
    finally:
        os.close(root_fd)


__all__ = ["safe_tree_category"]
