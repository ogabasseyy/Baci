"""Create a source-only workspace snapshot for the synthetic builder fixture."""
from __future__ import annotations

import os
import stat
from pathlib import Path

SOURCE_FILES = (
    "package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", ".baci-source-sha",
    "apps/web/package.json", "vps-workers/package.json",
    "vps-workers/pnpm-workspace.yaml", "vps-workers/pnpm-lock.yaml",
)
MAX_SOURCE_FILE_BYTES = 1_048_576
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


class SyntheticSourceRejected(RuntimeError):
    """The fixture's fixed synthetic source inputs are not safe to snapshot."""


def copy_snapshot(workspace: Path, snapshot: Path, *, owner_uid: int | None = None,
                  owner_gid: int | None = None) -> None:
    """Copy only fixed manifests and locks; never include pnpm install artifacts."""
    workspace = Path(workspace)
    snapshot = Path(snapshot)
    owner_uid = os.getuid() if owner_uid is None else owner_uid
    owner_gid = os.getgid() if owner_gid is None else owner_gid
    if (not workspace.is_absolute() or not snapshot.is_absolute()
            or workspace == snapshot or snapshot.exists() or snapshot.is_symlink()
            or type(owner_uid) is not int or owner_uid < 0
            or type(owner_gid) is not int or owner_gid < 0):
        raise SyntheticSourceRejected("synthetic source snapshot paths are invalid")
    root_fd = -1
    try:
        root_fd = os.open(workspace, DIRECTORY_FLAGS)
        root_info = os.fstat(root_fd)
        named_root = workspace.lstat()
        if (root_info.st_uid != owner_uid or not stat.S_ISDIR(root_info.st_mode)
                or (root_info.st_dev, root_info.st_ino) != (named_root.st_dev, named_root.st_ino)):
            raise SyntheticSourceRejected("synthetic workspace root is unsafe")
        snapshot.mkdir(mode=0o700)
        (snapshot / "apps/web").mkdir(mode=0o700, parents=True)
        (snapshot / "vps-workers").mkdir(mode=0o700)
        for relative in SOURCE_FILES:
            parts = Path(relative).parts
            parent_fd = os.dup(root_fd)
            try:
                for component in parts[:-1]:
                    child_fd = os.open(component, DIRECTORY_FLAGS, dir_fd=parent_fd)
                    os.close(parent_fd)
                    parent_fd = child_fd
                before = os.stat(parts[-1], dir_fd=parent_fd, follow_symlinks=False)
                if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid
                        or before.st_nlink != 1 or before.st_size > MAX_SOURCE_FILE_BYTES):
                    raise SyntheticSourceRejected("synthetic source input is not a bounded regular file")
                source_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                target_fd = -1
                try:
                    opened = os.fstat(source_fd)
                    if (opened.st_dev, opened.st_ino, opened.st_size) != (
                            before.st_dev, before.st_ino, before.st_size):
                        raise SyntheticSourceRejected("synthetic source input changed before copy")
                    target = snapshot.joinpath(*parts)
                    target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                        | os.O_NOFOLLOW, 0o600)
                    remaining = opened.st_size
                    while remaining:
                        block = os.read(source_fd, min(65_536, remaining))
                        if not block:
                            raise SyntheticSourceRejected("synthetic source input truncated during copy")
                        view = memoryview(block)
                        while view:
                            count = os.write(target_fd, view)
                            if count <= 0:
                                raise SyntheticSourceRejected("synthetic source snapshot write failed")
                            view = view[count:]
                        remaining -= len(block)
                    after = os.fstat(source_fd)
                    if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                            after.st_ctime_ns) != (opened.st_dev, opened.st_ino, opened.st_size,
                                                  opened.st_mtime_ns, opened.st_ctime_ns):
                        raise SyntheticSourceRejected("synthetic source input changed during copy")
                    os.fchown(target_fd, owner_uid, owner_gid)
                    os.fchmod(target_fd, 0o440)
                    os.fsync(target_fd)
                finally:
                    if target_fd >= 0:
                        os.close(target_fd)
                    os.close(source_fd)
            finally:
                os.close(parent_fd)
        for directory in (snapshot / "apps", snapshot / "apps/web", snapshot / "vps-workers"):
            os.chown(directory, owner_uid, owner_gid)
            os.chmod(directory, 0o550)
        os.chown(snapshot, owner_uid, owner_gid)
        os.chmod(snapshot, 0o550)
        if (workspace.lstat().st_ino, workspace.lstat().st_dev) != (root_info.st_ino, root_info.st_dev):
            raise SyntheticSourceRejected("synthetic workspace path changed during snapshot")
    except BaseException:
        if snapshot.exists() and not snapshot.is_symlink():
            for current, directories, files in os.walk(snapshot, topdown=False, followlinks=False):
                for name in files:
                    Path(current, name).unlink(missing_ok=True)
                for name in directories:
                    path = Path(current, name)
                    if path.is_symlink():
                        path.unlink(missing_ok=True)
                    else:
                        path.chmod(0o700)
                        path.rmdir()
            snapshot.chmod(0o700)
            snapshot.rmdir()
        raise
    finally:
        if root_fd >= 0:
            os.close(root_fd)


__all__ = ["SOURCE_FILES", "SyntheticSourceRejected", "copy_snapshot"]
