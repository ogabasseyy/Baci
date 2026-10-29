"""Bounded regular-file materialization for dependency candidate installation."""
from __future__ import annotations

import os
import shutil
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, MAX_ENTRIES, MAX_PAYLOAD_BYTES

MAX_MATERIALIZED_BYTES = MAX_PAYLOAD_BYTES
MAX_MATERIALIZED_ENTRIES = MAX_ENTRIES


def _copy_file(source: Path, destination: Path, budget: dict[str, int]) -> None:
    before = source.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise BuilderRejected("dependency candidate contains an unsafe file")
    budget["entries"] += 1
    budget["bytes"] += before.st_size
    if budget["entries"] > MAX_MATERIALIZED_ENTRIES or budget["bytes"] > MAX_MATERIALIZED_BYTES:
        raise BuilderRejected("materialized dependency candidate exceeds configured bounds")
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    destination_fd = -1
    try:
        opened = os.fstat(source_fd)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise BuilderRejected("dependency candidate changed while installing")
        destination_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        copied = 0
        while True:
            block = os.read(source_fd, min(1024 * 1024, before.st_size - copied + 1))
            if not block:
                break
            copied += len(block)
            if copied > before.st_size:
                raise BuilderRejected("dependency candidate grew while installing")
            view = memoryview(block)
            while view:
                count = os.write(destination_fd, view)
                if count <= 0:
                    raise BuilderRejected("dependency install write failed")
                view = view[count:]
        after = os.fstat(source_fd)
        if (copied != before.st_size or before.st_mtime_ns != after.st_mtime_ns
                or before.st_ctime_ns != after.st_ctime_ns):
            raise BuilderRejected("dependency candidate changed while installing")
        os.fchmod(destination_fd, 0o550 if before.st_mode & 0o111 else 0o440)
    finally:
        if destination_fd >= 0:
            os.close(destination_fd)
        os.close(source_fd)


def _materialize_directory(source: Path, destination: Path, payload_root: Path,
                           budget: dict[str, int], ancestors: frozenset[tuple[int, int]]) -> None:
    resolved = source.resolve(strict=True)
    try:
        resolved.relative_to(payload_root)
    except ValueError as error:
        raise BuilderRejected("dependency symlink escapes candidate payload") from error
    before = resolved.lstat()
    if not stat.S_ISDIR(before.st_mode):
        raise BuilderRejected("dependency link target is not a directory")
    inode = (before.st_dev, before.st_ino)
    if inode in ancestors:
        raise BuilderRejected("dependency directory link is cyclic")
    budget["entries"] += 1
    if budget["entries"] > MAX_MATERIALIZED_ENTRIES:
        raise BuilderRejected("materialized dependency candidate has too many entries")
    destination.mkdir(mode=0o700)
    next_ancestors = ancestors | {inode}
    for entry in sorted(os.scandir(resolved), key=lambda item: item.name):
        child = Path(entry.path)
        target = destination / entry.name
        info = child.lstat()
        if stat.S_ISDIR(info.st_mode):
            _materialize_directory(child, target, payload_root, budget, next_ancestors)
        elif stat.S_ISREG(info.st_mode):
            _copy_file(child, target, budget)
        elif stat.S_ISLNK(info.st_mode):
            link_target = os.readlink(child)
            resolved_child = child.resolve(strict=True)
            try:
                resolved_child.relative_to(payload_root)
            except ValueError as error:
                raise BuilderRejected("dependency symlink escapes candidate payload") from error
            after = child.lstat()
            if ((info.st_dev, info.st_ino) != (after.st_dev, after.st_ino)
                    or link_target != os.readlink(child)):
                raise BuilderRejected("dependency symlink changed while installing")
            if resolved_child.is_dir():
                _materialize_directory(resolved_child, target, payload_root, budget, next_ancestors)
            elif resolved_child.is_file():
                _copy_file(resolved_child, target, budget)
            else:
                raise BuilderRejected("dependency symlink target is not a regular file or directory")
        else:
            raise BuilderRejected("dependency candidate contains a special file")
    after = resolved.lstat()
    if ((before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
            or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
        raise BuilderRejected("dependency candidate directory changed while installing")
    os.chmod(destination, 0o550)


def _remove_partial_tree(path: Path, *, owner_uid: int) -> None:
    """Remove only an owned directory created by this install attempt."""
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid:
        raise BuilderRejected("partial dependency target changed before cleanup")
    if not shutil.rmtree.avoids_symlink_attacks:
        raise BuilderRejected("safe dependency rollback cleanup is unavailable")
    for current, directories, _files in os.walk(path, topdown=True, followlinks=False):
        current_path = Path(current)
        current_info = current_path.lstat()
        if not stat.S_ISDIR(current_info.st_mode) or current_info.st_uid != owner_uid:
            raise BuilderRejected("partial dependency tree ownership changed before cleanup")
        os.chmod(current_path, 0o700, follow_symlinks=False)
        for name in directories:
            child = current_path / name
            child_info = child.lstat()
            if stat.S_ISDIR(child_info.st_mode):
                if child_info.st_uid != owner_uid:
                    raise BuilderRejected("partial dependency subdirectory ownership changed")
                os.chmod(child, 0o700, follow_symlinks=False)
    shutil.rmtree(path)
    if os.path.lexists(path):
        raise BuilderRejected("partial dependency target remains after cleanup")


def _remove_partial_tree_or_raise(path: Path, *, owner_uid: int) -> None:
    try:
        _remove_partial_tree(path, owner_uid=owner_uid)
    except Exception as error:
        raise BuilderRejected(
            "dependency installation failed and partial release state remains; discard the incoming release"
        ) from error


def install_payload(payload: Path, release_root: Path, *, owner_uid: int) -> None:
    if os.geteuid() != owner_uid:
        raise BuilderRejected("dependency installer must run as the release tree owner")
    info = release_root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
        raise BuilderRejected("dependency integration directory is not trusted")
    web_root = release_root / "apps" / "web"
    for directory in (release_root / "apps", web_root):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
            raise BuilderRejected("frozen release web directory is unsafe")
    targets = ((payload / "web" / "node_modules", web_root / "node_modules"),
               (payload / "root" / "node_modules", release_root / "node_modules"))
    for _, target in targets:
        if os.path.lexists(target):
            raise BuilderRejected("release already contains a dependency target")
    created: list[Path] = []
    budget = {"entries": 0, "bytes": 0}
    payload_root = payload.resolve(strict=True)
    try:
        for source, target in targets:
            created.append(target)
            _materialize_directory(source, target, payload_root, budget, frozenset())
    except BaseException as install_error:
        cleanup_errors: list[Exception] = []
        for target in reversed(created):
            try:
                _remove_partial_tree_or_raise(target, owner_uid=owner_uid)
            except Exception as cleanup_error:
                cleanup_errors.append(cleanup_error)
        if cleanup_errors:
            raise BuilderRejected(
                "dependency installation failed and partial release state remains; discard the incoming release"
            ) from cleanup_errors[0]
        if isinstance(install_error, BuilderRejected):
            raise
        raise


__all__ = ["install_payload"]
