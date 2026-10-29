"""Experiment-only normalization under a private, single-job scratch assumption.

The link-count census rejects aliases outside the payload and protects against
ordinary path replacement with descriptor-relative no-follow operations. It is
not an isolation boundary against a concurrent process running as the same UID:
such a process can create/remove hardlinks or mutate files between checks. The
CI experiment therefore requires its private TemporaryDirectory and no untrusted
same-UID concurrent jobs. Production must not rely on this normalizer as a
substitute for UID isolation; its strict payload validator remains authoritative.
"""
from __future__ import annotations

import os
import secrets
import stat
from collections import defaultdict
from pathlib import Path


class HardlinkBoundaryError(RuntimeError):
    """A regular file has aliases outside the candidate payload."""

    safe_subtype = "external-hardlink"

    def __init__(self, roots: tuple[str, ...], group_count: int):
        self.safe_roots = roots
        self.safe_group_count = min(max(group_count, 1), 200_000)
        super().__init__("candidate contains hardlinks outside its payload")


def normalize_internal_hardlinks(root: Path, *, max_bytes: int, max_entries: int,
                                  before_copy=None) -> dict[str, int]:
    """Copy only candidate-internal hardlinks to independent files.

    A complete no-follow census proves each multiply-linked inode has exactly
    as many directory entries inside root as its kernel link count. Any external
    alias is rejected before file contents are read or modified.
    """
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    try:
        root_info = os.fstat(root_fd)
        if not stat.S_ISDIR(root_info.st_mode):
            raise RuntimeError("candidate root is not a directory")
        groups: dict[tuple[int, int], dict[str, object]] = {}
        totals = {"entries": 0, "bytes": 0}

        def scan(directory_fd: int, prefix: str = "") -> None:
            before = os.fstat(directory_fd)
            for name in sorted(os.listdir(directory_fd)):
                if name in {"", ".", ".."} or "/" in name or "\\" in name:
                    raise RuntimeError("candidate contains an unsafe entry name")
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                totals["entries"] += 1
                if totals["entries"] > max_entries:
                    raise RuntimeError("candidate entry bound exceeded during hardlink scan")
                relative = f"{prefix}/{name}" if prefix else name
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY
                                    | getattr(os, "O_NOFOLLOW", 0), dir_fd=directory_fd)
                    try:
                        opened = os.fstat(child)
                        if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                            raise RuntimeError("candidate directory changed during hardlink scan")
                        scan(child, relative)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode):
                    totals["bytes"] += info.st_size
                    if totals["bytes"] > max_bytes:
                        raise RuntimeError("candidate size bound exceeded during hardlink scan")
                    if info.st_nlink > 1:
                        key = (info.st_dev, info.st_ino)
                        group = groups.setdefault(key, {"link_count": info.st_nlink,
                                                        "paths": [], "size": info.st_size})
                        if (group["link_count"] != info.st_nlink or group["size"] != info.st_size):
                            raise RuntimeError("candidate hardlink group changed during scan")
                        paths = group["paths"]
                        assert isinstance(paths, list)
                        paths.append(relative)
                elif not stat.S_ISLNK(info.st_mode):
                    raise RuntimeError("candidate contains a special file")
            after = os.fstat(directory_fd)
            if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeError("candidate changed during hardlink scan")

        scan(root_fd)
        internal_groups = [(key, group) for key, group in groups.items()
                           if len(group["paths"]) == group["link_count"]]
        external_groups = len(groups) - len(internal_groups)
        if external_groups:
            roots = set()
            for group in groups.values():
                if len(group["paths"]) == group["link_count"]:
                    continue
                for relative in group["paths"]:
                    roots.add("web" if relative.startswith("web/") else
                              "worker" if relative.startswith("root/") else "other")
            raise HardlinkBoundaryError(tuple(sorted(roots)), external_groups)

        copies = 0
        for device_inode, group in internal_groups:
            paths = sorted(group["paths"])
            expected_links = int(group["link_count"])
            for relative in paths[1:]:
                parent_fd, name = _open_parent(root_fd, relative)
                try:
                    source_fd = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                                        dir_fd=parent_fd)
                    temporary_name = f".candidate-copy-{secrets.token_hex(16)}"
                    temporary_created = False
                    target_fd = -1
                    try:
                        source_info = os.fstat(source_fd)
                        if ((source_info.st_dev, source_info.st_ino) != device_inode
                                or source_info.st_nlink != expected_links
                                or source_info.st_size != group["size"]):
                            raise RuntimeError("candidate hardlink identity changed before copy")
                        if before_copy is not None:
                            before_copy(source_info.st_size)
                        target_fd = os.open(temporary_name,
                                            os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                            | getattr(os, "O_NOFOLLOW", 0), 0o600,
                                            dir_fd=parent_fd)
                        temporary_created = True
                        copied = 0
                        while block := os.read(source_fd, 1024 * 1024):
                            copied += len(block)
                            if copied > source_info.st_size:
                                raise RuntimeError("candidate file grew during hardlink copy")
                            _write_all(target_fd, block)
                        after = os.fstat(source_fd)
                        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                        if (copied != source_info.st_size
                                or (source_info.st_dev, source_info.st_ino,
                                    source_info.st_size, source_info.st_mtime_ns,
                                    source_info.st_ctime_ns, source_info.st_nlink) != (
                                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                                    after.st_ctime_ns, after.st_nlink)
                                or (named.st_dev, named.st_ino) != device_inode):
                            raise RuntimeError("candidate hardlink changed during copy")
                        os.fchmod(target_fd, stat.S_IMODE(source_info.st_mode))
                        os.fsync(target_fd)
                        os.close(target_fd)
                        target_fd = -1
                        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                        if ((current.st_dev, current.st_ino) != device_inode
                                or current.st_nlink != expected_links):
                            raise RuntimeError("candidate hardlink changed before replacement")
                        os.replace(temporary_name, name, src_dir_fd=parent_fd,
                                   dst_dir_fd=parent_fd)
                        temporary_created = False
                        expected_links -= 1
                        copies += 1
                    finally:
                        if target_fd >= 0:
                            os.close(target_fd)
                        os.close(source_fd)
                        if temporary_created:
                            try:
                                os.unlink(temporary_name, dir_fd=parent_fd)
                            except FileNotFoundError:
                                pass
                finally:
                    os.close(parent_fd)
        return {"hardlink_groups_normalized": len(internal_groups),
                "hardlink_files_copied": copies, "external_hardlink_groups": 0}
    finally:
        os.close(root_fd)


def _open_parent(root_fd: int, relative: str) -> tuple[int, str]:
    parts = relative.split("/")
    fd = os.dup(root_fd)
    try:
        for component in parts[:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY
                            | getattr(os, "O_NOFOLLOW", 0), dir_fd=fd)
            os.close(fd)
            fd = child
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def _write_all(fd: int, block: bytes) -> None:
    view = memoryview(block)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise RuntimeError("candidate independent copy failed")
        view = view[written:]
