"""Descriptor-based validation of the fixed release-lock filesystem view."""

from __future__ import annotations

import os
import posixpath
import stat
from pathlib import Path


class StatusError(RuntimeError):
    """The endpoint cannot establish a trustworthy lock status."""


def validate_directory_fd(info: os.stat_result, *, uid: int | None = None,
                          exact_mode: int | None = None) -> None:
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or
            (uid is not None and info.st_uid != uid)):
        raise StatusError("release lock directory metadata is untrusted")
    if exact_mode is not None:
        if stat.S_IMODE(info.st_mode) != exact_mode:
            raise StatusError("release lock directory mode is untrusted")
    elif info.st_mode & 0o022:
        raise StatusError("release lock directory is writable by another user")


def open_directory_at(parent_fd: int, name: str) -> int:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        return os.open(name, flags, dir_fd=parent_fd)
    except OSError as error:
        raise StatusError("release lock path is unavailable or contains a symlink") from error


def _unescape_mountinfo_field(value: str) -> str:
    return value.replace("\\040", " ").replace("\\011", "\t").replace("\\012", "\n").replace("\\134", "\\")


def validate_mountinfo(text: str, *, view_directory: Path) -> None:
    """Verify the unit's fixed source suffix and unique read-only view mount.

    The root field is relative to the source filesystem. It is either the
    full host path (root filesystem) or lacks the leading /home component
    (a separate /home filesystem). The pinned systemd unit supplies the exact
    BindReadOnlyPaths source; this suffix check confirms the mount topology.
    """
    mounts = []
    for line in text.splitlines():
        fields = line.split(" - ", 1)
        if len(fields) != 2:
            continue
        columns = fields[0].split()
        if len(columns) < 6:
            continue
        mounts.append({
            "root": posixpath.normpath(_unescape_mountinfo_field(columns[3])),
            "mountpoint": posixpath.normpath(_unescape_mountinfo_field(columns[4])),
            "options": set(columns[5].split(",")),
        })
    view_mounts = [mount for mount in mounts if mount["mountpoint"] == str(view_directory)]
    if len(view_mounts) != 1 or "ro" not in view_mounts[0]["options"]:
        raise StatusError("lock-state view is not a unique read-only mount")
    if view_mounts[0]["root"] not in {
        "/home/baci-release/.local/state/baci",
        "/baci-release/.local/state/baci",
    }:
        raise StatusError("lock-state view source root does not match the fixed home path")


def verify_readonly_bind_view(*, view_directory: Path) -> None:
    """Verify systemd's pinned bind projection without crossing the home sandbox."""
    try:
        text = Path("/proc/self/mountinfo").read_text(encoding="utf-8")
    except OSError as error:
        raise StatusError("lock-state bind mount cannot be verified") from error
    validate_mountinfo(text, view_directory=view_directory)


def read_lock_status_at(*, lock_path: Path, lock_filename: str, view_directory: Path,
                        runtime_directory: Path, release_uid: int, root_uid: int = 0) -> str:
    """Inspect the fixed view through pinned directory FDs and fstat."""
    lock_path = Path(os.path.abspath(lock_path))
    view_directory = Path(os.path.abspath(view_directory))
    runtime_directory = Path(os.path.abspath(runtime_directory))
    if (lock_path != view_directory / lock_filename or
            view_directory != runtime_directory / "lock-state" or release_uid <= 0):
        raise StatusError("release lock path is not the fixed view namespace")
    current_fd = os.open("/", os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
    lock_fd = None
    try:
        validate_directory_fd(os.fstat(current_fd), uid=0, exact_mode=None)
        current_path = Path("/")
        for component in view_directory.relative_to("/").parts:
            current_path /= component
            next_fd = open_directory_at(current_fd, component)
            info = os.fstat(next_fd)
            if current_path == runtime_directory:
                validate_directory_fd(info, uid=root_uid, exact_mode=None)
            elif current_path == view_directory:
                validate_directory_fd(info, uid=release_uid, exact_mode=0o700)
            else:
                validate_directory_fd(info, uid=None, exact_mode=None)
            os.close(current_fd)
            current_fd = next_fd
        flags = getattr(os, "O_PATH", os.O_RDONLY) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NONBLOCK", 0)
        try:
            lock_fd = os.open(lock_path.name, flags, dir_fd=current_fd)
        except FileNotFoundError:
            return "unlocked"
        except OSError as error:
            raise StatusError("release lock cannot be inspected") from error
        info = os.fstat(lock_fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != release_uid or
                stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise StatusError("release lock metadata is untrusted")
        return "locked"
    except OSError as error:
        raise StatusError("release lock path is unavailable") from error
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        os.close(current_fd)
