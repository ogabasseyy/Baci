"""Exact cleanup and verification for interrupted seed workspace provisioning."""
from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_journal import SeedWorkspaceJournal


def recover_interrupted_setup(journal: SeedWorkspaceJournal, *, runner: Callable[..., object],
                              image: Path, workspace: Path, unit_dir: Path,
                              unit_name: str, unit_payload: bytes, image_bytes: int,
                              verify_complete: Callable[[tuple[int, int]], None],
                              owner_uid: int = 0) -> str:
    """Return absent/complete or remove only transaction-owned incomplete setup."""
    record = journal.read()
    if record is None:
        return "absent"
    tx = str(record["transaction_id"])
    if record["phase"] == "complete":
        identity = record.get("image_identity")
        if not isinstance(identity, list) or len(identity) != 2:
            raise BuilderRejected("completed seed workspace journal lacks image identity")
        image_info = _regular_image(image, owner_uid=owner_uid, maximum_size=image_bytes,
                                    require_exact_size=True)
        if (image_info.st_dev, image_info.st_ino) != (identity[0], identity[1]):
            raise BuilderRejected("completed seed workspace image identity changed")
        _require_exact_unit(unit_dir / unit_name, unit_payload, owner_uid)
        verify_complete((identity[0], identity[1]))
        return "complete"

    unit_path = unit_dir / unit_name
    unit_temp = unit_dir / f".{unit_name}.{tx}.tmp"
    if os.path.lexists(unit_temp):
        temp_info = unit_temp.lstat()
        if (not stat.S_ISREG(temp_info.st_mode) or temp_info.st_uid != owner_uid
                or temp_info.st_nlink not in (1, 2) or stat.S_IMODE(temp_info.st_mode) not in (0o600, 0o644)
                or temp_info.st_size > len(unit_payload)):
            raise BuilderRejected("interrupted seed workspace unit temporary is unsafe")
        temp_fd = os.open(unit_temp, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            temp_opened = os.fstat(temp_fd)
            if (temp_opened.st_dev, temp_opened.st_ino) != (temp_info.st_dev, temp_info.st_ino):
                raise BuilderRejected("interrupted seed workspace unit temporary changed")
            content = os.read(temp_fd, len(unit_payload) + 1)
            if content != unit_payload[:len(content)]:
                raise BuilderRejected("interrupted seed workspace unit temporary is unrecognized")
        finally:
            os.close(temp_fd)
        if temp_info.st_nlink == 2:
            try:
                published = unit_path.lstat()
            except FileNotFoundError as error:
                raise BuilderRejected("seed workspace unit hardlink window lacks published name") from error
            if ((published.st_dev, published.st_ino) != (temp_info.st_dev, temp_info.st_ino)
                    or content != unit_payload or published.st_nlink != 2
                    or not stat.S_ISREG(published.st_mode) or published.st_uid != owner_uid
                    or stat.S_IMODE(published.st_mode) != 0o644):
                raise BuilderRejected("seed workspace unit hardlink window is not exact")
        elif os.path.lexists(unit_path):
            raise BuilderRejected("seed workspace unit temporary conflicts with published name")
        unit_temp.unlink()
        _fsync_directory(unit_dir)
    unit_exists = os.path.lexists(unit_path)
    if unit_exists:
        _require_exact_unit(unit_path, unit_payload, owner_uid)
        _run(runner, ("/usr/bin/systemctl", "disable", "--now", unit_name), timeout=90)
        active = _query(runner, ("/usr/bin/systemctl", "show", "--property=ActiveState",
                                "--value", unit_name), timeout=3)
        if active not in {"inactive", "failed"}:
            raise BuilderRejected("interrupted seed workspace unit did not stop")
        _run(runner, ("/usr/bin/systemctl", "daemon-reload"), timeout=10)
    elif os.path.lexists(unit_dir / "local-fs.target.wants" / unit_name):
        raise BuilderRejected("orphan seed workspace enablement link is ambiguous")

    if os.path.ismount(workspace):
        raise BuilderRejected("interrupted seed workspace remains mounted")
    _require_no_loop(runner, image)
    image_identity = record.get("image_identity")
    image_info = None
    if os.path.lexists(image):
        # A planned journal is durable evidence that the fixed image name was
        # absent before setup. If SIGKILL lands between O_EXCL creation and the
        # inode-record update, cleanup is bounded to this root-private parent,
        # exact owner/mode/link count, and the configured image-size ceiling.
        # This relies on the documented same-UID trusted-root boundary.
        image_info = _regular_image(image, owner_uid=owner_uid, maximum_size=image_bytes)
        if image_identity is not None and (image_info.st_dev, image_info.st_ino) != tuple(image_identity):
            raise BuilderRejected("interrupted seed workspace image inode differs from journal")
    mountpoint = workspace.lstat()
    if (not stat.S_ISDIR(mountpoint.st_mode) or mountpoint.st_uid != owner_uid
            or stat.S_IMODE(mountpoint.st_mode) != 0o700 or os.listdir(workspace)):
        raise BuilderRejected("interrupted seed workspace mountpoint is not empty and private")

    if unit_exists:
        unit_path.unlink()
        _fsync_directory(unit_dir)
    if image_info is not None:
        current = image.lstat()
        if (current.st_dev, current.st_ino) != (image_info.st_dev, image_info.st_ino):
            raise BuilderRejected("interrupted seed workspace image changed before removal")
        image.unlink()
        _fsync_directory(image.parent)
    journal.clear(tx)
    return "recovered"


def _regular_image(path: Path, *, owner_uid: int, maximum_size: int,
                   require_exact_size: bool = False) -> os.stat_result:
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > maximum_size
            or info.st_size < 0 or (require_exact_size and info.st_size != maximum_size)):
        raise BuilderRejected("seed workspace image is not an exact provisioner artifact")
    return info


def _require_exact_unit(path: Path, payload: bytes, owner_uid: int) -> None:
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o644 or path.read_bytes() != payload):
        raise BuilderRejected("seed workspace unit differs from the fixed provisioner contract")


def _run(runner: Callable[..., object], args: tuple[str, ...], *, timeout: float) -> object:
    try:
        return runner(args, check=True, stdin=subprocess.DEVNULL,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                      timeout=timeout, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderRejected("seed workspace recovery command failed") from error


def _query(runner: Callable[..., object], args: tuple[str, ...], *, timeout: float) -> str:
    try:
        result = runner(args, check=True, stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                        timeout=timeout, text=True,
                        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderRejected("seed workspace recovery state is unavailable") from error
    return result.stdout.strip()


def _require_no_loop(runner: Callable[..., object], image: Path) -> None:
    try:
        result = runner(("/usr/sbin/losetup", "--associated", "--noheadings", str(image)),
                        check=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, timeout=3, text=True,
                        env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderRejected("seed workspace loop state is unavailable") from error
    if result.returncode not in (0, 1) or result.stdout.strip():
        raise BuilderRejected("seed workspace image remains attached to a loop device")


def _fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
