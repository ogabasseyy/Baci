"""Descriptor-anchored integrity checks for frozen dependency source snapshots.

This module proves that the same bounded, immutable tree remains at a pinned
pathname across a build. It does not authenticate the archive or authorize a
caller. It assumes no concurrent hostile process with the snapshot owner UID;
an owner can chmod or replace its own files despite read-only modes.
"""
from __future__ import annotations

import hashlib
import os
import stat
import struct
from dataclasses import dataclass
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected

MAX_SNAPSHOT_ENTRIES = 500_000
MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024
MAX_SNAPSHOT_DEPTH = 128
MAX_SNAPSHOT_PATH_BYTES = 4096
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
_FILE_FLAGS = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
_ACL_XATTR = "system.posix_acl_access"


def _expected_reader_acl(mode: int, read_uids: tuple[int, ...]) -> bytes:
    permissions = 0x05 if mode & 0o111 else 0x04
    undefined = 0xFFFFFFFF
    entries = [(0x01, permissions, undefined)]
    entries.extend((0x02, permissions, uid) for uid in sorted(read_uids))
    entries.extend(((0x04, 0, undefined), (0x10, permissions, undefined),
                    (0x20, 0, undefined)))
    return struct.pack("<I", 2) + b"".join(
        struct.pack("<HHI", tag, perm, qualifier) for tag, perm, qualifier in entries
    )


def _verify_reader_acl(fd: int, mode: int, read_uids: tuple[int, ...]) -> bytes:
    try:
        actual = os.getxattr(fd, _ACL_XATTR)
    except OSError as error:
        raise BuilderRejected("source snapshot reader ACL is unavailable") from error
    expected = _expected_reader_acl(mode, read_uids)
    if actual != expected:
        raise BuilderRejected("source snapshot reader ACL does not match fixed policy")
    return actual


def _metadata(fd: int) -> tuple[int, ...]:
    item = os.fstat(fd)
    return (item.st_dev, item.st_ino, item.st_uid, item.st_gid, item.st_mode,
            item.st_nlink, item.st_size, item.st_mtime_ns, item.st_ctime_ns)


def _metadata_from_stat(item: os.stat_result) -> tuple[int, ...]:
    return (item.st_dev, item.st_ino, item.st_uid, item.st_gid, item.st_mode,
            item.st_nlink, item.st_size, item.st_mtime_ns, item.st_ctime_ns)


def _ancestor_identity(metadata: tuple[int, ...]) -> tuple[int, ...]:
    """Return path identity fields unaffected by sibling entry changes.

    Trusted roots may also contain separately journaled build results. Creating
    or removing those siblings changes directory size/link count/timestamps,
    but does not replace the pinned source path or any ancestor inode.
    """
    return metadata[:5]


def _open_path_chain(path: Path, *, owner_uid: int) -> tuple[list[int], list[tuple[str, tuple[int, ...]]]]:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
        raise BuilderRejected("source snapshot path must be absolute and normalized")
    parts = path.parts[1:]
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise BuilderRejected("source snapshot path is invalid")
    fds = [os.open("/", _DIR_FLAGS)]
    identities = [("/", _metadata(fds[0]))]
    try:
        current = fds[0]
        for part in parts:
            child = os.open(part, _DIR_FLAGS, dir_fd=current)
            info = os.fstat(child)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, owner_uid}
                    or info.st_mode & 0o022):
                os.close(child)
                raise BuilderRejected("source snapshot ancestor is not trusted")
            fds.append(child)
            identities.append((part, _metadata(child)))
            current = child
        return fds, identities
    except BaseException:
        for fd in reversed(fds):
            os.close(fd)
        raise


def _tree_digest(root_fd: int, *, owner_uid: int, max_entries: int, max_bytes: int,
                 max_depth: int, max_path_bytes: int,
                 read_uids: tuple[int, ...] = ()) -> str:
    digest = hashlib.sha256()
    counts = {"entries": 0, "bytes": 0}

    def visit(directory_fd: int, relative: str = "", depth: int = 0) -> None:
        before = _metadata(directory_fd)
        if read_uids:
            acl = _verify_reader_acl(directory_fd, stat.S_IMODE(before[4]), read_uids)
            digest.update(b"a\0" + relative.encode("utf-8") + b"\0" + acl)
        for name in sorted(os.listdir(directory_fd)):
            if name in {"", ".", ".."} or "/" in name or "\\" in name:
                raise BuilderRejected("source snapshot contains an unsafe entry name")
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            counts["entries"] += 1
            if counts["entries"] > max_entries:
                raise BuilderRejected("source snapshot exceeds entry limit")
            child_relative = f"{relative}/{name}" if relative else name
            encoded = child_relative.encode("utf-8", errors="strict")
            child_depth = depth + 1
            if child_depth > max_depth:
                raise BuilderRejected("source snapshot exceeds depth limit")
            if len(encoded) > max_path_bytes:
                raise BuilderRejected("source snapshot exceeds relative path limit")
            if stat.S_ISDIR(info.st_mode):
                child_fd = os.open(name, _DIR_FLAGS, dir_fd=directory_fd)
                try:
                    opened = _metadata(child_fd)
                    if (_metadata_from_stat(info) != opened or info.st_uid != owner_uid
                            or stat.S_IMODE(info.st_mode) != 0o550):
                        raise BuilderRejected("source snapshot directory changed during verification")
                    digest.update(b"d\0" + encoded + b"\0" + repr(opened).encode("ascii") + b"\0")
                    visit(child_fd, child_relative, child_depth)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(info.st_mode):
                if (info.st_uid != owner_uid or info.st_nlink != 1
                        or stat.S_IMODE(info.st_mode) not in (0o440, 0o550)):
                    raise BuilderRejected("source snapshot file ownership or mode is unsafe")
                counts["bytes"] += info.st_size
                if counts["bytes"] > max_bytes:
                    raise BuilderRejected("source snapshot exceeds byte limit")
                fd = os.open(name, _FILE_FLAGS, dir_fd=directory_fd)
                try:
                    opened = _metadata(fd)
                    if (_metadata_from_stat(info) != opened or opened[2] != owner_uid
                            or opened[5] != 1):
                        raise BuilderRejected("source snapshot file changed before reading")
                    if read_uids:
                        acl = _verify_reader_acl(fd, stat.S_IMODE(opened[4]), read_uids)
                        digest.update(b"a\0" + child_relative.encode("utf-8") + b"\0" + acl)
                    digest.update(b"f\0" + encoded + b"\0" + repr(opened).encode("ascii") + b"\0")
                    remaining = info.st_size
                    while remaining:
                        block = os.read(fd, min(1024 * 1024, remaining))
                        if not block:
                            raise BuilderRejected("source snapshot file truncated during verification")
                        digest.update(block)
                        remaining -= len(block)
                    if _metadata(fd) != opened:
                        raise BuilderRejected("source snapshot file changed during verification")
                    named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    if _metadata_from_stat(named) != opened:
                        raise BuilderRejected("source snapshot file path changed during verification")
                finally:
                    os.close(fd)
            else:
                raise BuilderRejected("source snapshot contains a symlink or special file")
        if _metadata(directory_fd) != before:
            raise BuilderRejected("source snapshot directory changed during verification")

    visit(root_fd)
    return digest.hexdigest()


def _assert_path_identity(path: Path, trusted_root: Path, owner_uid: int,
                          identities: list[tuple[str, tuple[int, ...]]]) -> None:
    fds, current = _open_path_chain(trusted_root, owner_uid=owner_uid)
    try:
        if (len(current) != len(identities) - 1
                or any(name != expected_name
                       or _ancestor_identity(actual_metadata)
                       != _ancestor_identity(expected_metadata)
                       for (name, actual_metadata), (expected_name, expected_metadata)
                       in zip(current, identities[:-1]))):
            raise BuilderRejected("source snapshot ancestor path changed during build")
        opened = os.open(path.name, _DIR_FLAGS, dir_fd=fds[-1])
        try:
            if _metadata(opened) != identities[-1][1]:
                raise BuilderRejected("source snapshot root path changed during build")
        finally:
            os.close(opened)
    finally:
        for fd in reversed(fds):
            os.close(fd)


@dataclass
class PinnedSourceSnapshot:
    """Held ancestor/root descriptors and a bounded immutable tree digest."""

    path: Path
    trusted_root: Path
    owner_uid: int
    max_entries: int
    max_bytes: int
    max_depth: int
    max_path_bytes: int
    read_uids: tuple[int, ...]
    digest: str
    _fds: list[int]
    _identities: list[tuple[str, tuple[int, ...]]]
    _closed: bool = False

    def verify_unchanged(self) -> None:
        if self._closed:
            raise BuilderRejected("source snapshot pin is closed")

        _assert_path_identity(self.path, self.trusted_root, self.owner_uid, self._identities)
        if _metadata(self._fds[-1]) != self._identities[-1][1]:
            raise BuilderRejected("pinned source snapshot root changed during build")
        current = _tree_digest(self._fds[-1], owner_uid=self.owner_uid,
                               max_entries=self.max_entries, max_bytes=self.max_bytes,
                               max_depth=self.max_depth, max_path_bytes=self.max_path_bytes,
                               read_uids=self.read_uids)
        if current != self.digest:
            raise BuilderRejected("source snapshot contents changed during build")
        _assert_path_identity(self.path, self.trusted_root, self.owner_uid, self._identities)
        if _metadata(self._fds[-1]) != self._identities[-1][1]:
            raise BuilderRejected("pinned source snapshot root changed during build")

    def close(self) -> None:
        if not self._closed:
            for fd in reversed(self._fds):
                os.close(fd)
            self._closed = True

    def __enter__(self) -> "PinnedSourceSnapshot":
        if self._closed:
            raise BuilderRejected("source snapshot pin is closed")
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


def pin_source_snapshot(path: Path, *, trusted_root: Path, owner_uid: int,
                        max_entries: int = MAX_SNAPSHOT_ENTRIES,
                        max_bytes: int = MAX_SNAPSHOT_BYTES,
                        max_depth: int = MAX_SNAPSHOT_DEPTH,
                        max_path_bytes: int = MAX_SNAPSHOT_PATH_BYTES,
                        read_uids: tuple[int, ...] = ()) -> PinnedSourceSnapshot:
    """Pin a direct child of a private root and return its initial tree digest."""
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise BuilderRejected("descriptor-safe source snapshot verification is unavailable")
    path = Path(path)
    trusted_root = Path(trusted_root)
    if (type(owner_uid) is not int or owner_uid < 0 or type(max_entries) is not int
            or not 1 <= max_entries <= MAX_SNAPSHOT_ENTRIES
            or type(max_bytes) is not int or not 0 <= max_bytes <= MAX_SNAPSHOT_BYTES
            or type(max_depth) is not int or not 0 <= max_depth <= MAX_SNAPSHOT_DEPTH
            or type(max_path_bytes) is not int or not 1 <= max_path_bytes <= MAX_SNAPSHOT_PATH_BYTES
            or not isinstance(read_uids, tuple)
            or any(type(uid) is not int or uid <= 0 for uid in read_uids)
            or len(read_uids) != len(set(read_uids))
            or not path.is_absolute() or not trusted_root.is_absolute()
            or path.parent != trusted_root or path.name in {"", ".", ".."}):
        raise BuilderRejected("source snapshot bounds or location are invalid")
    ancestor_fds, identities = _open_path_chain(trusted_root, owner_uid=owner_uid)
    root_fd = -1
    try:
        anchor = os.fstat(ancestor_fds[-1])
        if anchor.st_uid != owner_uid or stat.S_IMODE(anchor.st_mode) != 0o700:
            raise BuilderRejected("source snapshot trusted root must be private")
        root_fd = os.open(path.name, _DIR_FLAGS, dir_fd=ancestor_fds[-1])
        info = os.fstat(root_fd)
        if (info.st_uid != owner_uid or stat.S_IMODE(info.st_mode) != 0o550):
            raise BuilderRejected("source snapshot root ownership or mode is unsafe")
        fds = ancestor_fds + [root_fd]
        identities.append((path.name, _metadata(root_fd)))
        digest = _tree_digest(root_fd, owner_uid=owner_uid,
                              max_entries=max_entries, max_bytes=max_bytes,
                              max_depth=max_depth, max_path_bytes=max_path_bytes,
                              read_uids=read_uids)
        _assert_path_identity(path, trusted_root, owner_uid, identities)
        if _metadata(root_fd) != identities[-1][1]:
            raise BuilderRejected("pinned source snapshot root changed during initial verification")
        return PinnedSourceSnapshot(path, trusted_root, owner_uid, max_entries, max_bytes,
                                    max_depth, max_path_bytes, read_uids, digest, fds, identities)
    except BaseException:
        if root_fd >= 0:
            os.close(root_fd)
        for fd in reversed(ancestor_fds):
            os.close(fd)
        raise
