"""Descriptor-relative copying, hashing, freezing, and publication primitives."""
from __future__ import annotations

import hashlib
import os
import stat

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import child_directory


def measure_frozen_tree(directory_fd: int, *, owner_uid: int, max_entries: int,
                        max_bytes: int) -> tuple[int, int]:
    """Return bounded bytes and entries for an immutable descriptor tree."""
    total_bytes = total_entries = 0

    def visit(fd: int) -> None:
        nonlocal total_bytes, total_entries
        before = os.fstat(fd)
        for name in os.listdir(fd):
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            total_entries += 1
            if total_entries > max_entries or info.st_uid != owner_uid or info.st_mode & 0o222:
                raise BuilderRejected("frozen seed exceeds quota or has unsafe ownership/mode")
            if stat.S_ISDIR(info.st_mode):
                child = child_directory(fd, name, owner_uid=owner_uid, immutable=True)
                try:
                    opened = os.fstat(child)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("frozen seed directory changed during quota scan")
                    visit(child)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
                try:
                    opened = os.fstat(file_fd)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("frozen seed file changed during quota scan")
                    total_bytes += opened.st_size
                    if total_bytes > max_bytes:
                        raise BuilderRejected("frozen seed exceeds aggregate byte quota")
                    after = os.fstat(file_fd)
                    if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
                            after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise BuilderRejected("frozen seed file changed during quota scan")
                finally:
                    os.close(file_fd)
            else:
                raise BuilderRejected("frozen seed contains a link or special file")
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise BuilderRejected("frozen seed changed during quota scan")

    visit(directory_fd)
    return total_entries, total_bytes


def assert_staging_tree(directory_fd: int, *, owner_uid: int,
                        max_entries: int, max_bytes: int) -> tuple[int, int]:
    """Validate a private unpublished tree before a terminal-proof cleanup."""
    entries = total = 0

    def visit(fd: int) -> None:
        nonlocal entries, total
        before = os.fstat(fd)
        if (not stat.S_ISDIR(before.st_mode) or before.st_uid != owner_uid
                or before.st_mode & 0o022):
            raise BuilderRejected("staging directory ownership or mode is unsafe")
        for name in os.listdir(fd):
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            entries += 1
            if entries > max_entries or info.st_uid != owner_uid or info.st_mode & 0o022:
                raise BuilderRejected("staging tree exceeds quota or has unsafe ownership/mode")
            if stat.S_ISDIR(info.st_mode):
                child = child_directory(fd, name, owner_uid=owner_uid)
                try:
                    opened = os.fstat(child)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("staging directory changed during validation")
                    visit(child)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                total += info.st_size
                if total > max_bytes:
                    raise BuilderRejected("staging tree exceeds byte limit")
                file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
                try:
                    opened = os.fstat(file_fd)
                    if (info.st_dev, info.st_ino, info.st_size) != (
                            opened.st_dev, opened.st_ino, opened.st_size):
                        raise BuilderRejected("staging file changed during validation")
                finally:
                    os.close(file_fd)
            else:
                raise BuilderRejected("staging tree contains a link or special file")
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise BuilderRejected("staging tree changed during validation")

    visit(directory_fd)
    return entries, total


def tree_usage_fd(directory_fd: int, *, max_bytes: int, max_entries: int,
                  owner_uid: int | None = None) -> tuple[int, int]:
    """Measure a copy input safely for aggregate quota preflight."""
    owner = os.geteuid() if owner_uid is None else owner_uid
    count = total = 0

    def visit(fd: int) -> None:
        nonlocal count, total
        before = os.fstat(fd)
        for name in os.listdir(fd):
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            count += 1
            if (count > max_entries or info.st_uid != owner or info.st_mode & 0o022):
                raise BuilderRejected("seed input exceeds quota or has unsafe ownership/mode")
            if stat.S_ISDIR(info.st_mode):
                child = child_directory(fd, name, owner_uid=owner)
                try:
                    opened = os.fstat(child)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("seed input directory changed during quota scan")
                    visit(child)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
                try:
                    opened = os.fstat(file_fd)
                    if (info.st_dev, info.st_ino, info.st_size) != (
                            opened.st_dev, opened.st_ino, opened.st_size):
                        raise BuilderRejected("seed input file changed during quota scan")
                    total += opened.st_size
                    if total > max_bytes:
                        raise BuilderRejected("seed input exceeds byte limit")
                    after = os.fstat(file_fd)
                    if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
                            after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise BuilderRejected("seed input file changed during quota scan")
                finally:
                    os.close(file_fd)
            else:
                raise BuilderRejected("seed input contains a link or special file")
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
            raise BuilderRejected("seed input directory changed during quota scan")

    visit(directory_fd)
    return count, total


def tree_digest_fd(directory_fd: int, *, max_bytes: int, owner_uid: int | None = None) -> str:
    """Hash a tree by descriptor, binding relative names, bytes, and executable bits."""
    owner = os.geteuid() if owner_uid is None else owner_uid
    root = os.fstat(directory_fd)
    if not stat.S_ISDIR(root.st_mode) or root.st_uid != owner or root.st_mode & 0o022:
        raise BuilderRejected("seed input tree root is unsafe")
    digest = hashlib.sha256()
    total = entries = 0

    def visit(fd: int, prefix: str = "") -> None:
        nonlocal total, entries
        before = os.fstat(fd)
        for name in sorted(os.listdir(fd)):
            if not name or name in {".", ".."} or "/" in name or "\\" in name:
                raise BuilderRejected("seed input tree contains malformed entry")
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            relative = f"{prefix}/{name}" if prefix else name
            encoded = relative.encode()
            entries += 1
            if entries > 200_000 or info.st_uid != owner or info.st_mode & 0o022:
                raise BuilderRejected("seed input tree contains an unsafe entry")
            if stat.S_ISDIR(info.st_mode):
                digest.update(b"D" + len(encoded).to_bytes(4, "big") + encoded)
                child = child_directory(fd, name, owner_uid=owner)
                try:
                    visit(child, relative)
                finally:
                    os.close(child)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                digest.update(b"F" + len(encoded).to_bytes(4, "big") + encoded)
                digest.update(b"X" if info.st_mode & 0o111 else b"-")
                file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
                try:
                    opened = os.fstat(file_fd)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("seed file changed while hashing")
                    file_hash = hashlib.sha256()
                    while block := os.read(file_fd, 1024 * 1024):
                        total += len(block)
                        if total > max_bytes:
                            raise BuilderRejected("seed input tree exceeds its byte limit")
                        file_hash.update(block)
                    after = os.fstat(file_fd)
                    if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                            opened.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size,
                            after.st_mtime_ns, after.st_ctime_ns):
                        raise BuilderRejected("seed file changed while hashing")
                    digest.update(file_hash.digest())
                finally:
                    os.close(file_fd)
            else:
                raise BuilderRejected("seed input tree contains a link or special file")
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise BuilderRejected("seed input directory changed while hashing")

    visit(directory_fd)
    return digest.hexdigest()


def policy_cache_digest_fd(directory_fd: int, *, max_bytes: int) -> str:
    """Match worker_release_dependency_policy_cache._hash_tree using a dirfd."""
    root = os.fstat(directory_fd)
    owner = os.geteuid()
    if not stat.S_ISDIR(root.st_mode) or root.st_uid != owner or root.st_mode & 0o022:
        raise BuilderRejected("pnpm policy cache ownership or mode is unsafe")
    digest = hashlib.sha256()
    total = entries = 0

    def visit(fd: int, prefix: str = "") -> None:
        nonlocal total, entries
        before = os.fstat(fd)
        names = os.listdir(fd)
        directories: list[str] = []
        files: list[str] = []
        for name in names:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            entries += 1
            if entries > 100_000 or info.st_uid != owner or info.st_mode & 0o022:
                raise BuilderRejected("pnpm policy cache contains an unsafe entry")
            if stat.S_ISDIR(info.st_mode):
                directories.append(name)
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                files.append(name)
            else:
                raise BuilderRejected("pnpm policy cache contains a link or special file")
        for name in sorted(files):
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
            relative = f"{prefix}/{name}" if prefix else name
            encoded = relative.encode("utf-8")
            digest.update(len(encoded).to_bytes(4, "big") + encoded)
            file_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
            try:
                opened = os.fstat(file_fd)
                if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                    raise BuilderRejected("pnpm policy cache changed while hashing")
                content_hash = hashlib.sha256()
                while block := os.read(file_fd, 1024 * 1024):
                    total += len(block)
                    if total > max_bytes:
                        raise BuilderRejected("pnpm policy cache exceeds its byte limit")
                    content_hash.update(block)
                after = os.fstat(file_fd)
                if (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                        opened.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size,
                        after.st_mtime_ns, after.st_ctime_ns):
                    raise BuilderRejected("pnpm policy cache changed while hashing")
                digest.update(content_hash.digest())
            finally:
                os.close(file_fd)
        for name in directories:
            relative = f"{prefix}/{name}" if prefix else name
            child = child_directory(fd, name, owner_uid=owner)
            try:
                visit(child, relative)
            finally:
                os.close(child)
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns
        ):
            raise BuilderRejected("pnpm policy cache changed while hashing")

    visit(directory_fd)
    return digest.hexdigest()


