"""Atomic root-owned installation helpers for the worker release boundary."""
from __future__ import annotations
import os
import stat
import tempfile
import grp
from pathlib import Path
from typing import Any

def read_existing(path: Path) -> tuple[bytes, os.stat_result] | None:
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0:
        raise RuntimeError(f"existing protected target is not a root-owned regular file: {path}")
    return path.read_bytes(), metadata


def install_one(file: Any) -> None:
    file.destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    parent = file.destination.parent
    while parent != parent.parent:
        metadata = parent.lstat()
        if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or
                metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) & 0o022):
            raise RuntimeError(f"protected target ancestry is not root-owned and private: {parent}")
        parent = parent.parent
    old = read_existing(file.destination)
    if old is not None:
        old_content, metadata = old
        expected_gid = grp.getgrnam(file.group).gr_gid
        if old_content != file.content or stat.S_IMODE(metadata.st_mode) != file.mode or metadata.st_gid != expected_gid:
            raise RuntimeError(f"existing protected file differs; refusing overwrite: {file.destination}")
        return
    fd, temporary = tempfile.mkstemp(prefix=".baci-install-", dir=file.destination.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(file.content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, 0, grp.getgrnam(file.group).gr_gid)
        os.chmod(temporary, file.mode)
        os.replace(temporary, file.destination)
        directory_fd = os.open(file.destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
