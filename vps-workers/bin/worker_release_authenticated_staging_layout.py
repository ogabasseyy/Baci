"""Freeze staged source and briefly reopen fixed install parent directories."""
from __future__ import annotations

import os
import stat
from pathlib import Path


def freeze_release(root: Path, *, owner_uid: int, worker_gid: int, rejected) -> None:
    for current, directories, files in os.walk(root, topdown=False, followlinks=False):
        parent = Path(current)
        for name in files:
            path = parent / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise rejected("staged source contains a link or special file")
            os.chown(path, owner_uid, worker_gid, follow_symlinks=False)
            os.chmod(path, 0o550 if info.st_mode & 0o111 else 0o440, follow_symlinks=False)
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        for name in directories:
            path = parent / name
            info = path.lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise rejected("staged source contains a non-directory entry")
            os.chown(path, owner_uid, worker_gid, follow_symlinks=False)
            os.chmod(path, 0o550, follow_symlinks=False)
        os.chown(parent, owner_uid, worker_gid, follow_symlinks=False)
        os.chmod(parent, 0o550, follow_symlinks=False)
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def enable_install_parents(root: Path, *, owner_uid: int, rejected) -> None:
    for path in (root, root / "apps", root / "apps" / "web"):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid or info.st_mode & 0o022:
            raise rejected("dependency install parent is unsafe")
        os.chmod(path, 0o750, follow_symlinks=False)
