"""Descriptor-pinned, bounded validation for a frozen materialized release."""
from __future__ import annotations

import hashlib
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path

class CandidatePinRejected(RuntimeError):
    """The incoming candidate is not a stable frozen regular-file tree."""

MAX_ENTRIES = 500_000
MAX_BYTES = 2 * 1024 * 1024 * 1024
MAX_DEPTH = 128
MAX_PATH_BYTES = 4096
RELEASES_ROOT = Path("/srv/baci-workers/releases")
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
TX_RE = re.compile(r"^\.([0-9a-f]{40})\.incoming\.([0-9a-f]{32})$")


def _identity(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _open_parent_chain(parent: Path, *, owner_uid: int) -> int:
    if not parent.is_absolute() or parent != Path(os.path.normpath(str(parent))):
        raise CandidatePinRejected("candidate path is not normalized")
    fds = [os.open("/", DIR_FLAGS)]
    try:
        for component in parent.parts[1:]:
            child = os.open(component, DIR_FLAGS, dir_fd=fds[-1])
            info = os.fstat(child)
            if (info.st_uid not in {0, owner_uid} or info.st_mode & 0o022
                    or not stat.S_ISDIR(info.st_mode)):
                os.close(child)
                raise CandidatePinRejected("candidate ancestor is untrusted")
            fds.append(child)
        for old_fd in fds[:-1]:
            os.close(old_fd)
        return fds[-1]
    except BaseException:
        for opened in reversed(fds):
            try:
                os.close(opened)
            except OSError:
                pass
        raise


def _tree_digest(root_fd: int, owner_uid: int, owner_gid: int) -> str:
    digest = hashlib.sha256()
    counts = {"entries": 0, "bytes": 0}

    def visit(directory_fd: int, prefix: str = "", depth: int = 0) -> None:
        before_dir = os.fstat(directory_fd)
        if (not stat.S_ISDIR(before_dir.st_mode) or before_dir.st_uid != owner_uid
                or before_dir.st_gid != owner_gid or stat.S_IMODE(before_dir.st_mode) != 0o550):
            raise CandidatePinRejected("candidate directory metadata is unsafe")
        for name in sorted(os.listdir(directory_fd)):
            if name in {"", ".", ".."} or "/" in name or "\\" in name:
                raise CandidatePinRejected("candidate entry name is unsafe")
            relative = f"{prefix}/{name}" if prefix else name
            encoded = relative.encode("utf-8", errors="strict")
            child_depth = depth + 1
            counts["entries"] += 1
            if counts["entries"] > MAX_ENTRIES or child_depth > MAX_DEPTH or len(encoded) > MAX_PATH_BYTES:
                raise CandidatePinRejected("candidate exceeds fixed tree bounds")
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode):
                child_fd = os.open(name, DIR_FLAGS, dir_fd=directory_fd)
                try:
                    opened = os.fstat(child_fd)
                    if _identity(opened) != _identity(info):
                        raise CandidatePinRejected("candidate directory changed while pinning")
                    digest.update(b"d\0" + encoded + b"\0" + repr(_identity(opened)).encode("ascii"))
                    visit(child_fd, relative, child_depth)
                    if _identity(os.stat(name, dir_fd=directory_fd, follow_symlinks=False)) != _identity(opened):
                        raise CandidatePinRejected("candidate directory path changed while pinning")
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(info.st_mode):
                if (info.st_uid != owner_uid or info.st_gid != owner_gid or info.st_nlink != 1
                        or stat.S_IMODE(info.st_mode) not in {0o440, 0o550}):
                    raise CandidatePinRejected("candidate file metadata is unsafe")
                counts["bytes"] += info.st_size
                if counts["bytes"] > MAX_BYTES:
                    raise CandidatePinRejected("candidate exceeds fixed byte bound")
                fd = os.open(name, FILE_FLAGS, dir_fd=directory_fd)
                try:
                    opened = os.fstat(fd)
                    if _identity(opened) != _identity(info):
                        raise CandidatePinRejected("candidate file changed before reading")
                    digest.update(b"f\0" + encoded + b"\0" + repr(_identity(opened)).encode("ascii"))
                    remaining = info.st_size
                    while remaining:
                        block = os.read(fd, min(1024 * 1024, remaining))
                        if not block:
                            raise CandidatePinRejected("candidate file was truncated")
                        digest.update(block)
                        remaining -= len(block)
                    if _identity(os.fstat(fd)) != _identity(opened):
                        raise CandidatePinRejected("candidate file changed while reading")
                    if _identity(os.stat(name, dir_fd=directory_fd, follow_symlinks=False)) != _identity(opened):
                        raise CandidatePinRejected("candidate file path changed while reading")
                finally:
                    os.close(fd)
            else:
                raise CandidatePinRejected("candidate contains a link or special file")
        if _identity(os.fstat(directory_fd)) != _identity(before_dir):
            raise CandidatePinRejected("candidate directory changed while pinning")

    visit(root_fd)
    return digest.hexdigest()


@dataclass
class CandidatePin:
    path: Path
    parent_fd: int
    candidate_fd: int
    parent_identity: tuple[int, ...]
    candidate_identity: tuple[int, ...]
    digest: str
    owner_uid: int
    owner_gid: int
    closed: bool = False

    def verify_unchanged(self) -> None:
        if self.closed:
            raise CandidatePinRejected("candidate pin is closed")
        parent = os.fstat(self.parent_fd)
        child = os.fstat(self.candidate_fd)
        named = os.stat(self.path.name, dir_fd=self.parent_fd, follow_symlinks=False)
        if (_identity(parent) != self.parent_identity or _identity(child) != self.candidate_identity
                or _identity(named) != self.candidate_identity):
            raise CandidatePinRejected("candidate inode changed during verification")
        if _tree_digest(self.candidate_fd, self.owner_uid, self.owner_gid) != self.digest:
            raise CandidatePinRejected("candidate tree changed during verification")

    def close(self) -> None:
        if not self.closed:
            os.close(self.candidate_fd)
            os.close(self.parent_fd)
            self.closed = True

    def __enter__(self) -> "CandidatePin":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


def pin_candidate(candidate: Path, *, expected_sha: str, owner_uid: int,
                  owner_gid: int) -> CandidatePin:
    match = TX_RE.fullmatch(candidate.name)
    if (not match or match.group(1) != expected_sha
            or candidate.parent != RELEASES_ROOT
            or candidate.parent != Path(os.path.normpath(str(candidate.parent)))
            or type(owner_uid) is not int or owner_uid < 0
            or type(owner_gid) is not int or owner_gid < 0):
        raise CandidatePinRejected("candidate name or ownership policy is invalid")
    parent_fd = _open_parent_chain(candidate.parent, owner_uid=owner_uid)
    candidate_fd = -1
    try:
        parent = os.fstat(parent_fd)
        if parent.st_uid != owner_uid or parent.st_mode & 0o022:
            raise CandidatePinRejected("candidate release parent is unsafe")
        candidate_fd = os.open(candidate.name, DIR_FLAGS, dir_fd=parent_fd)
        root = os.fstat(candidate_fd)
        if (root.st_uid != owner_uid or root.st_gid != owner_gid
                or stat.S_IMODE(root.st_mode) != 0o550):
            raise CandidatePinRejected("candidate root ownership or mode is unsafe")
        digest = _tree_digest(candidate_fd, owner_uid, owner_gid)
        named = os.stat(candidate.name, dir_fd=parent_fd, follow_symlinks=False)
        if _identity(named) != _identity(root):
            raise CandidatePinRejected("candidate path changed while pinning")
        return CandidatePin(candidate, parent_fd, candidate_fd, _identity(parent),
                            _identity(root), digest, owner_uid, owner_gid)
    except BaseException:
        if candidate_fd >= 0:
            os.close(candidate_fd)
        os.close(parent_fd)
        raise


__all__ = ["CandidatePin", "CandidatePinRejected", "RELEASES_ROOT", "pin_candidate"]
