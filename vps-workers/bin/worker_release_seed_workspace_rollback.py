"""Exact, fail-closed rollback for first-time seed-workspace provisioning."""
from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected


def _run(runner: Callable[..., object], args: tuple[str, ...], timeout: float) -> object:
    try:
        return runner(args, check=True, stdin=subprocess.DEVNULL,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                      timeout=timeout, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderRejected("seed workspace rollback command failed") from error


def rollback_created_state(runner: Callable[..., object], *, image: Path, workspace: Path,
                           unit_dir: Path, unit_name: str, unit_contents: bytes,
                           image_identity: tuple[int, int], unit_created: bool,
                           owner_uid: int = 0) -> None:
    """Remove only this invocation's image and unit after proving unmounted."""
    if unit_created:
        _run(runner, ("/usr/bin/systemctl", "disable", "--now", unit_name), 90)
        try:
            query = runner(("/usr/bin/systemctl", "show", "--property=ActiveState",
                            "--value", unit_name), check=True, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                           timeout=2, text=True, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        except (OSError, subprocess.SubprocessError) as error:
            raise BuilderRejected("seed workspace rollback state is unavailable") from error
        if query.stdout.strip() not in {"inactive", "failed"} or os.path.ismount(workspace):
            raise BuilderRejected("seed workspace rollback could not prove the mount stopped")
        try:
            loops = runner(("/usr/sbin/losetup", "--associated", "--noheadings", str(image)),
                           check=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, timeout=2, text=True,
                           env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
        except (OSError, subprocess.SubprocessError) as error:
            raise BuilderRejected("seed workspace loop-device state is unavailable") from error
        if loops.returncode != 0 or loops.stdout.strip():
            raise BuilderRejected("seed workspace image remains attached to a loop device")
        unit_path = unit_dir / unit_name
        unit_info = unit_path.lstat()
        if (not stat.S_ISREG(unit_info.st_mode) or unit_info.st_uid != owner_uid
                or unit_info.st_nlink != 1 or unit_path.read_bytes() != unit_contents):
            raise BuilderRejected("seed workspace rollback unit identity changed")
        unit_path.unlink()
        _fsync_directory(unit_dir)
        _run(runner, ("/usr/bin/systemctl", "daemon-reload"), 10)
    elif os.path.lexists(unit_dir / unit_name):
        raise BuilderRejected("unowned seed mount unit remains; preserving image")
    if os.path.ismount(workspace):
        raise BuilderRejected("seed workspace rollback refuses a mounted filesystem")
    info = image.lstat()
    if (info.st_dev, info.st_ino) != image_identity:
        raise BuilderRejected("seed workspace rollback image inode changed")
    if info.st_uid != owner_uid:
        raise BuilderRejected("seed workspace rollback image owner changed")
    image.unlink()
    _fsync_directory(image.parent)


def _fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
