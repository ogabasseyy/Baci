"""Narrow cleanup for a terminal publisher killed before opening its stage dir."""
from __future__ import annotations

import os
import re
import stat

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import child_directory
from dependency_seed_transaction import (
    publisher_is_terminal,
    read_inflight_journal,
    require_held_seed_lock,
)

STAGING_RE = re.compile(r"^\.[0-9a-f]{40}\.[0-9a-f]{32}$")


def remove_empty_unrecorded_stage(parent_fd: int, lock_fd: int, name: str) -> None:
    """Remove only an empty intended stage under a private pinned parent.

    Called only after the durable journal proves the creator terminal. The
    stage inode itself was not yet recorded, so any nonempty or swapped entry
    is preserved and recovery fails closed. The pinned 0700 root excludes all
    other UIDs; a concurrent writer with this same privileged UID is inside
    the trust boundary and is not made safe by POSIX rmdir semantics.
    """
    if not STAGING_RE.fullmatch(name):
        raise BuilderRejected("unrecorded staging name is malformed")
    require_held_seed_lock(parent_fd, lock_fd)
    journal, journal_fd = read_inflight_journal(parent_fd)
    try:
        if (journal["stagingName"] != name or journal["stagingDevice"] is not None
                or journal["stagingInode"] is not None or not publisher_is_terminal(journal)):
            raise BuilderRejected("unrecorded staging has no terminal journal proof")
    finally:
        os.close(journal_fd)
    parent = os.fstat(parent_fd)
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid()
            or stat.S_IMODE(parent.st_mode) != 0o700):
        raise BuilderRejected("unrecorded staging parent is not private")
    before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    stage_fd = child_directory(parent_fd, name, owner_uid=os.geteuid())
    try:
        stage = os.fstat(stage_fd)
        if ((before.st_dev, before.st_ino) != (stage.st_dev, stage.st_ino)
                or not stat.S_ISDIR(stage.st_mode) or stat.S_IMODE(stage.st_mode) != 0o700
                or stage.st_nlink != 2):
            raise BuilderRejected("unrecorded staging inode is unsafe")
        if os.listdir(stage_fd):
            raise BuilderRejected("unrecorded staging directory is not empty")
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if (current.st_dev, current.st_ino) != (stage.st_dev, stage.st_ino):
            raise BuilderRejected("unrecorded staging name changed during recovery")
        if os.listdir(stage_fd):
            raise BuilderRejected("unrecorded staging directory changed during recovery")
        os.rmdir(name, dir_fd=parent_fd)
        os.fsync(parent_fd)
    finally:
        os.close(stage_fd)
