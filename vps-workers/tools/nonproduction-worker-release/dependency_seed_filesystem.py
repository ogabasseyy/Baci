"""Descriptor-pinned filesystem helpers for the disconnected seed prototype."""
from __future__ import annotations

import ctypes
import errno
import os
import stat
from pathlib import Path
from collections.abc import Callable

from worker_release_dependency_artifacts import BuilderRejected

DIRECTORY_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)


def open_directory(path: Path, *, owner_uid: int, immutable: bool = False,
                   create: bool = False) -> int:
    """Walk an absolute path one no-follow component at a time."""
    requested = Path(path)
    if ".." in requested.parts:
        raise BuilderRejected("seed directory path contains parent traversal")
    absolute = requested if requested.is_absolute() else Path.cwd() / requested
    fd = os.open("/", DIRECTORY_FLAGS)
    try:
        for component in absolute.parts[1:]:
            try:
                child = os.open(component, DIRECTORY_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                try:
                    os.mkdir(component, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                child = os.open(component, DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
    except OSError as exc:
        os.close(fd)
        raise BuilderRejected("seed directory cannot be opened without following links") from exc
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or info.st_mode & 0o022 or (immutable and info.st_mode & 0o222)):
        os.close(fd)
        raise BuilderRejected("seed directory ownership or mode is unsafe")
    return fd


def child_directory(parent_fd: int, name: str, *, owner_uid: int,
                    immutable: bool = False) -> int:
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise BuilderRejected("seed path component is malformed")
    try:
        fd = os.open(name, DIRECTORY_FLAGS, dir_fd=parent_fd)
    except OSError as exc:
        raise BuilderRejected("seed child directory is unavailable") from exc
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or info.st_mode & 0o022 or (immutable and info.st_mode & 0o222)):
        os.close(fd)
        raise BuilderRejected("seed child directory ownership or mode is unsafe")
    return fd


def anchored_path(fd: int) -> Path:
    """Return a path whose leading directory is pinned by an open descriptor."""
    if not os.path.isdir("/proc/self/fd"):
        raise BuilderRejected("descriptor-pinned paths require Linux procfs")
    return Path(f"/proc/self/fd/{fd}/.")


def assert_frozen_tree(directory_fd: int, *, owner_uid: int) -> None:
    for name in os.listdir(directory_fd):
        if not name or name in {".", ".."} or "/" in name or "\\" in name:
            raise BuilderRejected("seed contains a malformed entry")
        try:
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except OSError as exc:
            raise BuilderRejected("seed entry changed during validation") from exc
        if info.st_uid != owner_uid or info.st_mode & 0o222:
            raise BuilderRejected("seed contains a writable or foreign-owned child")
        if stat.S_ISDIR(info.st_mode):
            child = child_directory(directory_fd, name, owner_uid=owner_uid, immutable=True)
            try:
                opened = os.fstat(child)
                if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                    raise BuilderRejected("seed directory changed during validation")
                assert_frozen_tree(child, owner_uid=owner_uid)
            finally:
                os.close(child)
        elif stat.S_ISREG(info.st_mode):
            if info.st_nlink != 1:
                raise BuilderRejected("seed file is hardlinked")
            fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
            try:
                opened = os.fstat(fd)
                if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                    raise BuilderRejected("seed file changed during validation")
            finally:
                os.close(fd)
        else:
            raise BuilderRejected("seed contains a link or special file")


def copy_tree(source_fd: int, parent_fd: int, destination: str, *, max_bytes: int,
              max_entries: int, aggregate_budget: dict[str, int] | None = None,
              capacity_check: Callable[[int, int], None] | None = None) -> int:
    """Copy a regular tree using only pinned directory descriptors."""
    os.mkdir(destination, 0o700, dir_fd=parent_fd)
    output_fd = child_directory(parent_fd, destination, owner_uid=os.geteuid())
    counts = {"bytes": 0, "entries": 0}

    def visit(input_fd: int, target_fd: int) -> None:
        before = os.fstat(input_fd)
        for name in sorted(os.listdir(input_fd)):
            if not name or name in {".", ".."} or "/" in name or "\\" in name:
                raise BuilderRejected("seed tree contains a malformed name")
            info = os.stat(name, dir_fd=input_fd, follow_symlinks=False)
            counts["entries"] += 1
            if counts["entries"] > max_entries:
                raise BuilderRejected("seed tree has too many entries")
            if capacity_check is not None:
                capacity_check(0, 1)
            if aggregate_budget is not None:
                aggregate_budget["entries"] += 1
                if aggregate_budget["entries"] > aggregate_budget["max_entries"]:
                    raise BuilderRejected("seed root exceeds aggregate entry quota during copy")
            if stat.S_ISDIR(info.st_mode):
                child_in = child_directory(input_fd, name, owner_uid=os.geteuid())
                try:
                    opened = os.fstat(child_in)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("seed input directory changed")
                    os.mkdir(name, 0o700, dir_fd=target_fd)
                    if capacity_check is not None:
                        capacity_check(0, 0)
                    child_out = child_directory(target_fd, name, owner_uid=os.geteuid())
                    try:
                        visit(child_in, child_out)
                    finally:
                        os.close(child_out)
                finally:
                    os.close(child_in)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                counts["bytes"] += info.st_size
                if counts["bytes"] > max_bytes:
                    raise BuilderRejected("seed tree exceeds its byte limit")
                if aggregate_budget is not None:
                    aggregate_budget["bytes"] += info.st_size
                    if aggregate_budget["bytes"] > aggregate_budget["max_bytes"]:
                        raise BuilderRejected("seed root exceeds aggregate byte quota during copy")
                in_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=input_fd)
                out_fd = -1
                try:
                    opened = os.fstat(in_fd)
                    if (info.st_dev, info.st_ino, info.st_size) != (
                        opened.st_dev, opened.st_ino, opened.st_size
                    ):
                        raise BuilderRejected("seed input file changed")
                    mode = 0o700 if info.st_mode & 0o111 else 0o600
                    out_fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                     | getattr(os, "O_NOFOLLOW", 0), mode, dir_fd=target_fd)
                    copied = 0
                    while block := os.read(in_fd, 1024 * 1024):
                        if capacity_check is not None:
                            capacity_check(len(block), 0)
                        copied += len(block)
                        if copied > info.st_size:
                            raise BuilderRejected("seed input file grew during copy")
                        view = memoryview(block)
                        while view:
                            written = os.write(out_fd, view)
                            if written <= 0:
                                raise BuilderRejected("seed copy short write")
                            view = view[written:]
                    after = os.fstat(in_fd)
                    if copied != info.st_size or (opened.st_dev, opened.st_ino, opened.st_mtime_ns,
                            opened.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_mtime_ns,
                            after.st_ctime_ns):
                        raise BuilderRejected("seed input file changed during copy")
                    os.fsync(out_fd)
                finally:
                    os.close(in_fd)
                    if out_fd >= 0:
                        os.close(out_fd)
            else:
                raise BuilderRejected("seed input contains a link or special file")
        after = os.fstat(input_fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise BuilderRejected("seed input directory changed during copy")
        os.fsync(target_fd)

    try:
        visit(source_fd, output_fd)
        return output_fd
    except BaseException:
        os.close(output_fd)
        raise


def freeze_tree(directory_fd: int) -> None:
    for name in os.listdir(directory_fd):
        info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            child = child_directory(directory_fd, name, owner_uid=os.geteuid())
            try:
                freeze_tree(child)
                os.fchmod(child, 0o555)
                os.fsync(child)
            finally:
                os.close(child)
        elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
            fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
            try:
                opened = os.fstat(fd)
                if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                    raise BuilderRejected("seed file changed while freezing")
                os.fchmod(fd, 0o555 if info.st_mode & 0o111 else 0o444)
                os.fsync(fd)
            finally:
                os.close(fd)
        else:
            raise BuilderRejected("seed contains a link or special file")
    os.fchmod(directory_fd, 0o555)
    os.fsync(directory_fd)


def remove_tree(parent_fd: int, name: str, *, expected_identity: tuple[int, int] | None = None) -> None:
    """Remove a private unpublished tree by dirfd, without path traversal."""
    root = child_directory(parent_fd, name, owner_uid=os.geteuid())
    try:
        opened_root = os.fstat(root)
        if expected_identity is not None and (opened_root.st_dev, opened_root.st_ino) != expected_identity:
            raise BuilderRejected("staging cleanup inode does not match journal")
        def remove(directory_fd: int) -> None:
            os.fchmod(directory_fd, 0o700)
            for entry in os.listdir(directory_fd):
                info = os.stat(entry, dir_fd=directory_fd, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    child = child_directory(directory_fd, entry, owner_uid=os.geteuid())
                    try:
                        remove(child)
                    finally:
                        os.close(child)
                    os.rmdir(entry, dir_fd=directory_fd)
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    os.unlink(entry, dir_fd=directory_fd)
                else:
                    raise BuilderRejected("staging cleanup encountered a link or special file")
        remove(root)
    finally:
        os.close(root)
    if expected_identity is not None:
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(named.st_mode) or (named.st_dev, named.st_ino) != expected_identity:
            raise BuilderRejected("staging cleanup path changed before removal")
    os.rmdir(name, dir_fd=parent_fd)




