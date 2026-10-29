"""Atomic root-owned installation helpers for the worker release boundary."""
from __future__ import annotations
import os
import stat
import tempfile
import grp
import errno
from pathlib import Path
from typing import Any

RUNTIME_VIEW_ROOT = Path("/var/lib/baci-worker-runtime-views")

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


def ensure_root_directory(path: Path, *, uid: int = 0, gid: int = 0,
                          mode: int = 0o711) -> None:
    """Create or validate one fixed directory through no-follow descriptors."""
    if not path.is_absolute() or path == Path("/") or ".." in path.parts:
        raise RuntimeError("protected directory path must be a fixed absolute child")
    directory_flag = getattr(os, "O_DIRECTORY", None)
    nofollow_flag = getattr(os, "O_NOFOLLOW", None)
    if directory_flag is None or nofollow_flag is None:
        raise RuntimeError("protected directory validation requires no-follow directory opens")
    flags = os.O_RDONLY | directory_flag | nofollow_flag
    current = os.open("/", flags)
    try:
        for index, part in enumerate(path.parts[1:], start=1):
            parent_info = os.fstat(current)
            if parent_info.st_uid not in {0, uid} or stat.S_IMODE(parent_info.st_mode) & 0o022:
                raise RuntimeError("protected directory ancestry is not trusted")
            is_target = index == len(path.parts) - 1
            try:
                child = os.open(part, flags, dir_fd=current)
            except FileNotFoundError:
                if not is_target:
                    raise RuntimeError("protected directory parent is missing") from None
                os.mkdir(part, mode, dir_fd=current)
                child = os.open(part, flags, dir_fd=current)
                created_info = os.fstat(child)
                if (created_info.st_uid, created_info.st_gid) != (uid, gid):
                    os.fchown(child, uid, gid)
                os.fchmod(child, mode)
            except OSError as error:
                if error.errno in {errno.ELOOP, errno.ENOTDIR}:
                    raise RuntimeError("protected directory path contains a symlink or non-directory") from None
                raise
            info = os.fstat(child)
            if info.st_uid not in {0, uid} or stat.S_IMODE(info.st_mode) & 0o022:
                os.close(child)
                raise RuntimeError("protected directory ancestry is not trusted")
            if is_target and (info.st_uid != uid or info.st_gid != gid or
                              stat.S_IMODE(info.st_mode) != mode):
                os.close(child)
                raise RuntimeError("protected directory ownership or mode is not trusted")
            os.close(current)
            current = child
    finally:
        os.close(current)


def ensure_runtime_view_root() -> None:
    ensure_root_directory(RUNTIME_VIEW_ROOT, uid=0, gid=0, mode=0o711)
