"""Descriptor pin for a private builder-result directory and its path chain."""
from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected

_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
MAX_CHILD_ENTRIES = 500_000
MAX_CHILD_BYTES = 2 * 1024 * 1024 * 1024
MAX_CHILD_DEPTH = 128


def _identity(fd: int) -> tuple[int, ...]:
    value = os.fstat(fd)
    return (value.st_dev, value.st_ino, value.st_uid, value.st_gid, value.st_mode)


def _open_chain(path: Path, owner_uid: int) -> tuple[list[int], list[tuple[int, ...]]]:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
        raise BuilderRejected("builder result root path must be absolute and normalized")
    fds = [os.open("/", _DIR_FLAGS)]
    identities = [_identity(fds[0])]
    try:
        for component in path.parts[1:]:
            child = os.open(component, _DIR_FLAGS, dir_fd=fds[-1])
            info = os.fstat(child)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, owner_uid}
                    or info.st_mode & 0o022):
                os.close(child)
                raise BuilderRejected("builder result root ancestor is not trusted")
            fds.append(child)
            identities.append(_identity(child))
        result = os.fstat(fds[-1])
        if result.st_uid != owner_uid or stat.S_IMODE(result.st_mode) != 0o700:
            raise BuilderRejected("builder result root must be owner-private")
        return fds, identities
    except BaseException:
        for fd in reversed(fds):
            os.close(fd)
        raise


@dataclass
class PinnedResultRoot:
    """Held root/ancestor descriptors; assumes no hostile process with owner UID."""

    path: Path
    owner_uid: int
    _fds: list[int]
    _identities: list[tuple[int, ...]]
    _closed: bool = False

    @property
    def fd(self) -> int:
        if self._closed:
            raise BuilderRejected("builder result root pin is closed")
        return self._fds[-1]

    def verify_unchanged(self) -> None:
        if self._closed:
            raise BuilderRejected("builder result root pin is closed")
        reopened, identities = _open_chain(self.path, self.owner_uid)
        try:
            if identities != self._identities:
                raise BuilderRejected("builder result root path changed")
            if _identity(self._fds[-1]) != self._identities[-1]:
                raise BuilderRejected("pinned builder result root changed")
        finally:
            for fd in reversed(reopened):
                os.close(fd)

    def close(self) -> None:
        if not self._closed:
            for fd in reversed(self._fds):
                os.close(fd)
            self._closed = True

    def __enter__(self) -> "PinnedResultRoot":
        if self._closed:
            raise BuilderRejected("builder result root pin is closed")
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


def pin_result_root(path: Path, *, owner_uid: int) -> PinnedResultRoot:
    """Pin an owner-private result root beneath non-writable trusted ancestors."""
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise BuilderRejected("descriptor-safe builder result root verification is unavailable")
    path = Path(path)
    if type(owner_uid) is not int or owner_uid < 0:
        raise BuilderRejected("builder result root owner is invalid")
    fds, identities = _open_chain(path, owner_uid)
    return PinnedResultRoot(path, owner_uid, fds, identities)


class PinnedResultDirectory:
    """Pin a direct result child; cleanup remains anchored to the parent FD.

    Candidate contents are produced by a trusted root supervisor. The build
    sandbox must run under a distinct UID; no hostile process may share the
    owner UID while validation or cleanup is in progress.
    """

    def __init__(self, parent: PinnedResultRoot, name: str, fd: int, identity: tuple[int, ...]):
        self.parent, self.name, self.fd, self.identity = parent, name, fd, identity
        self.path = parent.path / name
        self._closed = False

    def verify_unchanged(self) -> None:
        if self._closed:
            raise BuilderRejected("builder result directory pin is closed")
        self.parent.verify_unchanged()
        if _identity(self.fd) != self.identity:
            raise BuilderRejected("pinned builder result directory changed")
        try:
            named = os.stat(self.name, dir_fd=self.parent.fd, follow_symlinks=False)
        except OSError as error:
            raise BuilderRejected("builder result directory path changed") from error
        if _stat_identity(named) != self.identity:
            raise BuilderRejected("builder result directory path changed")

    def remove(self) -> None:
        """Remove only the pinned child tree using directory-relative operations."""
        self.verify_unchanged()
        counts = {"entries": 0, "bytes": 0}

        def empty(directory_fd: int, depth: int) -> None:
            if depth > MAX_CHILD_DEPTH:
                raise BuilderRejected("builder result cleanup exceeds depth limit")
            for child_name in os.listdir(directory_fd):
                if child_name in {"", ".", ".."} or "/" in child_name or "\\" in child_name:
                    raise BuilderRejected("builder result cleanup found an invalid name")
                counts["entries"] += 1
                if counts["entries"] > MAX_CHILD_ENTRIES:
                    raise BuilderRejected("builder result cleanup exceeds entry limit")
                item = os.stat(child_name, dir_fd=directory_fd, follow_symlinks=False)
                counts["bytes"] += item.st_size
                if counts["bytes"] > MAX_CHILD_BYTES:
                    raise BuilderRejected("builder result cleanup exceeds byte limit")
                if stat.S_ISDIR(item.st_mode):
                    child_fd = os.open(child_name, _DIR_FLAGS, dir_fd=directory_fd)
                    try:
                        if _identity(child_fd) != _stat_identity(item):
                            raise BuilderRejected("builder result cleanup entry changed")
                        empty(child_fd, depth + 1)
                    finally:
                        os.close(child_fd)
                    current = os.stat(child_name, dir_fd=directory_fd, follow_symlinks=False)
                    if _stat_identity(current) != _stat_identity(item):
                        raise BuilderRejected("builder result cleanup entry changed")
                    os.rmdir(child_name, dir_fd=directory_fd)
                else:
                    os.unlink(child_name, dir_fd=directory_fd)
        empty(self.fd, 0)
        self.verify_unchanged()
        os.rmdir(self.name, dir_fd=self.parent.fd)
        self.parent.verify_unchanged()

    def close(self) -> None:
        if not self._closed:
            os.close(self.fd)
            self._closed = True


def _stat_identity(value: os.stat_result) -> tuple[int, ...]:
    return (value.st_dev, value.st_ino, value.st_uid, value.st_gid, value.st_mode)


def pin_result_directory(parent: PinnedResultRoot, path: Path, *, owner_uid: int) -> PinnedResultDirectory:
    """Open and verify a single owner-private result directory under a pinned root."""
    path = Path(path)
    if (path.parent != parent.path or path.name in {"", ".", ".."}
            or Path(path.name).name != path.name or "/" in path.name or "\\" in path.name):
        raise BuilderRejected("dependency candidate is outside the pinned result root")
    parent.verify_unchanged()
    try:
        entry = os.stat(path.name, dir_fd=parent.fd, follow_symlinks=False)
        fd = os.open(path.name, _DIR_FLAGS, dir_fd=parent.fd)
    except OSError as error:
        raise BuilderRejected("dependency candidate directory is unavailable or unsafe") from error
    opened = os.fstat(fd)
    identity = _stat_identity(opened)
    if (_stat_identity(entry) != identity or not stat.S_ISDIR(opened.st_mode)
            or opened.st_uid != owner_uid or stat.S_IMODE(opened.st_mode) != 0o700):
        os.close(fd)
        raise BuilderRejected("dependency candidate directory ownership or inode is unsafe")
    pinned = PinnedResultDirectory(parent, path.name, fd, identity)
    try:
        pinned.verify_unchanged()
        return pinned
    except BaseException:
        pinned.close()
        raise
