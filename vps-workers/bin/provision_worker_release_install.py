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
SOURCE_FILE_MAX_BYTES = 16 * 1024 * 1024


def read_trusted_source(root: Path, relative: str, *, source_uid: int) -> bytes:
    """Read one fixed source file through pinned, no-follow directory FDs.

    Root-owned or caller-owned source checkouts are accepted, but no path
    component may be group/world writable. The caller supplies the checkout
    owner (normally SUDO_UID); file bytes and every opened path binding are
    revalidated before returning the immutable byte string.
    """
    root = Path(root)
    rel = Path(relative)
    if (not root.is_absolute() or root != Path(os.path.normpath(str(root)))
            or rel.is_absolute() or not rel.parts
            or any(part in {"", ".", ".."} or "\\" in part or "\x00" in part
                   for part in rel.parts)
            or type(source_uid) is not int or source_uid < 0):
        raise RuntimeError("trusted source path is malformed")
    directory_flag = getattr(os, "O_DIRECTORY", None)
    nofollow_flag = getattr(os, "O_NOFOLLOW", None)
    if directory_flag is None or nofollow_flag is None:
        raise RuntimeError("trusted source reads require no-follow directory descriptors")
    directory_flags = os.O_RDONLY | directory_flag | nofollow_flag
    descriptors = [os.open("/", directory_flags)]
    bindings: list[tuple[int, str, int]] = []
    file_fd = -1
    try:
        root_parts = root.parts[1:]
        for component in (*root_parts, *rel.parts[:-1]):
            parent_fd = descriptors[-1]
            try:
                child_fd = os.open(component, directory_flags, dir_fd=parent_fd)
            except OSError as error:
                raise RuntimeError("trusted source ancestry contains a symlink or is unavailable") from error
            info = os.fstat(child_fd)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, source_uid}
                    or info.st_mode & 0o022):
                os.close(child_fd)
                raise RuntimeError("trusted source ancestry ownership or mode is unsafe")
            descriptors.append(child_fd)
            bindings.append((parent_fd, component, child_fd))

        parent_fd = descriptors[-1]
        name = rel.parts[-1]
        try:
            file_fd = os.open(name, os.O_RDONLY | nofollow_flag, dir_fd=parent_fd)
        except OSError as error:
            raise RuntimeError("trusted source file is unavailable or a symlink") from error
        before = os.fstat(file_fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid not in {0, source_uid}
                or before.st_nlink != 1 or before.st_mode & 0o022
                or before.st_size > SOURCE_FILE_MAX_BYTES):
            raise RuntimeError("trusted source file ownership, type, or size is unsafe")
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino):
            raise RuntimeError("trusted source file path changed during open")

        chunks: list[bytes] = []
        total = 0
        while chunk := os.read(file_fd, min(1024 * 1024, SOURCE_FILE_MAX_BYTES + 1 - total)):
            total += len(chunk)
            if total > SOURCE_FILE_MAX_BYTES:
                raise RuntimeError("trusted source file exceeds its fixed size limit")
            chunks.append(chunk)
        after = os.fstat(file_fd)
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (named.st_dev, named.st_ino) != (after.st_dev, after.st_ino):
            raise RuntimeError("trusted source file path changed while being read")
        if (total != before.st_size or
                (before.st_dev, before.st_ino, before.st_uid, before.st_mode, before.st_nlink,
                 before.st_size, before.st_mtime_ns, before.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_uid, after.st_mode, after.st_nlink,
                 after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
            raise RuntimeError("trusted source file changed while being read")
        for bound_parent, component, bound_child in bindings:
            named_child = os.stat(component, dir_fd=bound_parent, follow_symlinks=False)
            opened_child = os.fstat(bound_child)
            if (not stat.S_ISDIR(named_child.st_mode)
                    or (named_child.st_dev, named_child.st_ino) !=
                    (opened_child.st_dev, opened_child.st_ino)):
                raise RuntimeError("trusted source ancestor path changed while being read")
        return b"".join(chunks)
    finally:
        if file_fd >= 0:
            os.close(file_fd)
        for descriptor in reversed(descriptors):
            os.close(descriptor)

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
