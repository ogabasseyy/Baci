"""Descriptor pin for a private builder-result directory and its path chain."""
from __future__ import annotations

import os
import stat
from dataclasses import dataclass
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected

_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)


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
