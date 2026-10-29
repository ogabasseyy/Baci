"""Descriptor-anchored chmod preparation for journal-owned cleanup."""
from __future__ import annotations

import os
import stat

from worker_release_stage_journal_io import StageJournalError


def make_tree_removable(releases_fd: int, name: str,
                        *, allowed_uids: int | tuple[int, ...]) -> None:
    """Make only real journal-owned directories writable through pinned FDs."""
    allowed = allowed_uids if isinstance(allowed_uids, tuple) else (allowed_uids,)

    def visit(fd: int) -> None:
        info = os.fstat(fd)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in allowed or info.st_mode & 0o022:
            raise StageJournalError("journal cleanup directory changed ownership or mode")
        for child_name in os.listdir(fd):
            if child_name in ("", ".", "..") or "/" in child_name or "\\" in child_name:
                raise StageJournalError("journal cleanup contains an invalid entry")
            child_info = os.stat(child_name, dir_fd=fd, follow_symlinks=False)
            if not stat.S_ISDIR(child_info.st_mode):
                continue
            child_fd = os.open(child_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=fd)
            try:
                opened = os.fstat(child_fd)
                if (child_info.st_dev, child_info.st_ino) != (opened.st_dev, opened.st_ino):
                    raise StageJournalError("journal cleanup directory was replaced")
                visit(child_fd)
            finally:
                os.close(child_fd)
        os.fchmod(fd, 0o700)

    root_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=releases_fd)
    try:
        visit(root_fd)
    finally:
        os.close(root_fd)


__all__ = ["make_tree_removable"]
