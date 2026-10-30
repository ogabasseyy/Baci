"""Post-drain ownership transfer and bounded freezing of worker seed outputs."""
from __future__ import annotations

import os
from pathlib import Path
import stat

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_filesystem import freeze_tree


def root_own_frozen_tree(path: Path, *, uid: int, max_bytes: int) -> None:
    """After exact unit drain, validate and transfer its private tree to root."""
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        counts = {"bytes": 0, "entries": 0}

        def visit(directory: int) -> None:
            before = os.fstat(directory)
            for name in os.listdir(directory):
                if not name or name in {".", ".."} or "/" in name or "\\" in name:
                    raise SeedGenerationRejected("seed worker output name is unsafe")
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                counts["entries"] += 1
                if counts["entries"] > 200_000 or info.st_uid != uid:
                    raise SeedGenerationRejected("seed worker output ownership or entry bound is unsafe")
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                    try:
                        opened = os.fstat(child)
                        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
                            raise SeedGenerationRejected("seed worker directory changed")
                        os.fchown(child, 0, 0)
                        visit(child)
                        os.fchmod(child, 0o700)
                        os.fsync(child)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                    file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
                    try:
                        opened = os.fstat(file_fd)
                        if (opened.st_dev, opened.st_ino, opened.st_size) != (
                                info.st_dev, info.st_ino, info.st_size):
                            raise SeedGenerationRejected("seed worker file changed")
                        counts["bytes"] += opened.st_size
                        if counts["bytes"] > max_bytes:
                            raise SeedGenerationRejected("seed worker output exceeds size limit")
                        os.fchown(file_fd, 0, 0)
                        os.fchmod(file_fd, 0o600)
                        os.fsync(file_fd)
                    finally:
                        os.close(file_fd)
                else:
                    raise SeedGenerationRejected("seed worker output has a link or special file")
            after = os.fstat(directory)
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                raise SeedGenerationRejected("seed worker directory identity changed")

        root_info = os.fstat(fd)
        if root_info.st_uid != uid:
            raise SeedGenerationRejected("seed worker output root has unexpected owner")
        os.fchown(fd, 0, 0)
        visit(fd)
        freeze_tree(fd)
    finally:
        os.close(fd)


__all__ = ["root_own_frozen_tree"]
