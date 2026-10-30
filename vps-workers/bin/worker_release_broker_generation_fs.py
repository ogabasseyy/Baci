"""Descriptor-relative filesystem primitives for broker generations."""
from __future__ import annotations

import os
import stat
from pathlib import Path

DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 96 * 1024 * 1024

class BrokerGenerationRejected(RuntimeError):
    """A broker generation is malformed, mutable, or does not match its digest."""

def _safe_parts(value: str) -> tuple[str, ...]:
    path = Path(value)
    if (not value or path.is_absolute() or "\\" in value or "\x00" in value
            or any(part in ("", ".", "..") for part in path.parts)):
        raise BrokerGenerationRejected("generation file path is invalid")
    return path.parts

def _open_directory(path: Path, *, uid: int, gid: int, mode: int,
                    create: bool = False) -> int:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
        raise BrokerGenerationRejected("generation root is not normalized")
    current = os.open("/", DIR_FLAGS)
    try:
        for index, component in enumerate(path.parts[1:]):
            target = index == len(path.parts) - 2
            try:
                child = os.open(component, DIR_FLAGS, dir_fd=current)
            except FileNotFoundError:
                if not create or not target:
                    raise BrokerGenerationRejected("generation root path is unavailable") from None
                os.mkdir(component, mode, dir_fd=current)
                child = os.open(component, DIR_FLAGS, dir_fd=current)
                os.fchown(child, uid, gid)
                os.fchmod(child, mode)
                os.fsync(current)
            info = os.fstat(child)
            if not stat.S_ISDIR(info.st_mode):
                os.close(child)
                raise BrokerGenerationRejected("generation root contains a non-directory")
            if target:
                if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (uid, gid, mode):
                    os.close(child)
                    raise BrokerGenerationRejected("generation root ownership or mode is unsafe")
            elif info.st_uid not in {0, uid} or info.st_mode & 0o022:
                os.close(child)
                raise BrokerGenerationRejected("generation root ancestor is unsafe")
            os.close(current)
            current = child
        return current
    except BaseException:
        os.close(current)
        raise


def _write_file(parent_fd: int, name: str, content: bytes, *, uid: int, gid: int, mode: int) -> None:
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                 0o600, dir_fd=parent_fd)
    try:
        os.fchown(fd, uid, gid)
        os.fchmod(fd, mode)
        view = memoryview(content)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise OSError("short write while creating broker generation")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def _ensure_subdirectory(parent_fd: int, name: str, *, uid: int, gid: int,
                         mode: int = 0o555) -> int:
    try:
        os.mkdir(name, mode, dir_fd=parent_fd)
    except FileExistsError:
        pass
    fd = os.open(name, DIR_FLAGS, dir_fd=parent_fd)
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != uid or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != mode):
        os.close(fd)
        raise BrokerGenerationRejected("generation directory metadata is unsafe")
    return fd


def _open_rel_parent(root_fd: int, parts: tuple[str, ...], *, uid: int, gid: int,
                     directory_mode: int = 0o555) -> tuple[int, str]:
    current = os.dup(root_fd)
    try:
        for component in parts[:-1]:
            child = _ensure_subdirectory(current, component, uid=uid, gid=gid,
                                         mode=directory_mode)
            os.close(current)
            current = child
        return current, parts[-1]
    except BaseException:
        os.close(current)
        raise


def _read_fd(fd: int, maximum: int) -> bytes:
    chunks = []
    total = 0
    while chunk := os.read(fd, min(1024 * 1024, maximum + 1 - total)):
        total += len(chunk)
        if total > maximum:
            raise BrokerGenerationRejected("generation file exceeds fixed limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _freeze_directory(fd: int, *, uid: int, gid: int) -> None:
    for name in os.listdir(fd):
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            child = os.open(name, DIR_FLAGS, dir_fd=fd)
            try:
                child_info = os.fstat(child)
                if (child_info.st_uid, child_info.st_gid) != (uid, gid):
                    raise BrokerGenerationRejected("generation directory owner changed")
                _freeze_directory(child, uid=uid, gid=gid)
                os.fchmod(child, 0o555)
                os.fsync(child)
            finally:
                os.close(child)
        elif not stat.S_ISREG(info.st_mode):
            raise BrokerGenerationRejected("generation contains a non-regular entry")


def _verify_exact_membership(root_fd: int, expected_files: set[str]) -> None:
    expected_dirs = {"/".join(parts[:index])
                     for path in expected_files
                     for parts in (_safe_parts(path),)
                     for index in range(1, len(parts))}
    found_files: set[str] = set()
    found_dirs: set[str] = set()

    def visit(fd: int, prefix: tuple[str, ...]) -> None:
        for name in os.listdir(fd):
            path_parts = (*prefix, name)
            path = "/".join(path_parts)
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                if path not in expected_dirs:
                    raise BrokerGenerationRejected("generation has an unlisted directory")
                found_dirs.add(path)
                child = os.open(name, DIR_FLAGS, dir_fd=fd)
                try:
                    visit(child, path_parts)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode):
                found_files.add(path)
            else:
                raise BrokerGenerationRejected("generation contains a link or special file")

    visit(root_fd, ())
    if found_files != expected_files | {"generation.json"} or found_dirs != expected_dirs:
        raise BrokerGenerationRejected("generation members do not match manifest")
