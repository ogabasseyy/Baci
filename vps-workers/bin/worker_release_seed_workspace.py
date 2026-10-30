"""Dry-run-first bounded loopback filesystem for dependency seed generation.

The filesystem is deliberately separate from the 4 GiB dependency-builder
mount. A fully allocated image gives the generator a hard byte and inode
ceiling; installation is a separate explicit operation.
"""
from __future__ import annotations

import argparse
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_seed_workspace_paths import (
    ensure_seed_collection,
    ensure_seed_workspace_directories,
    rename_noreplace,
    trusted_directory as _trusted_directory,
)
from worker_release_seed_workspace_rollback import rollback_created_state
from worker_release_seed_workspace_mount import (
    IMAGE, WORK_ROOT, UNIT_NAME, IMAGE_BYTES, INODE_COUNT, MOUNT_OPTIONS,
    verify_bounded_seed_workspace,
)

UNIT_DIR = Path("/etc/systemd/system")
PUBLISHED_SEED_ROOT_MAX_BYTES = 16 * 1024**3
HOST_RESERVE_BYTES = 8 * 1024**3
MIN_FREE_BYTES = IMAGE_BYTES + PUBLISHED_SEED_ROOT_MAX_BYTES + HOST_RESERVE_BYTES
MIN_HOST_FREE_INODES = 600_000
EXPECTED_OBSERVED_BYTES = 14_771_000_000
EXPECTED_OBSERVED_INODES = 786_000


def host_capacity(*, parent: Path = IMAGE.parent, minimum_bytes: int = MIN_FREE_BYTES) -> tuple[int, int]:
    """Return available bytes and inodes from the image's host filesystem."""
    _trusted_directory(parent)
    usage = os.statvfs(parent)
    free_bytes = usage.f_bavail * usage.f_frsize
    free_inodes = usage.f_favail
    if free_bytes < minimum_bytes or free_inodes < MIN_HOST_FREE_INODES:
        raise BuilderRejected("host filesystem lacks seed-image and reserve capacity")
    return free_bytes, free_inodes


def mount_unit_contents() -> bytes:
    return f"""[Unit]
Description=Bounded Baci worker dependency seed workspace
Before=local-fs.target baci-worker-release-broker.service
RequiresMountsFor={IMAGE.parent}

[Mount]
What={IMAGE}
Where={WORK_ROOT}
Type=ext4
Options={MOUNT_OPTIONS}
DirectoryMode=0700
TimeoutSec=30s

[Install]
WantedBy=local-fs.target
""".encode("ascii")


def _run(runner: Callable[..., object], args: tuple[str, ...], *, timeout: float) -> object:
    try:
        return runner(args, check=True, stdin=subprocess.DEVNULL,
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                      timeout=timeout, env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderRejected("seed workspace provisioning command failed") from error


def _write_unit(path: Path, payload: bytes, *, transaction_id: str) -> bool:
    parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parent = os.fstat(parent_fd)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
            raise BuilderRejected("seed mount unit directory is unsafe")
        try:
            existing = os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            existing = None
        if existing is not None:
            if (not stat.S_ISREG(existing.st_mode) or existing.st_uid != 0
                    or existing.st_nlink != 1 or stat.S_IMODE(existing.st_mode) != 0o644):
                raise BuilderRejected("existing seed mount unit is not the exact fixed unit")
            fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
            try:
                if os.read(fd, len(payload) + 1) != payload:
                    raise BuilderRejected("existing seed mount unit is not the exact fixed unit")
            finally:
                os.close(fd)
            return False
        temporary = f".{path.name}.{transaction_id}.tmp"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent_fd)
        try:
            view = memoryview(payload)
            while view:
                size = os.write(fd, view)
                if size <= 0:
                    raise BuilderRejected("seed mount unit write was incomplete")
                view = view[size:]
            os.fchmod(fd, 0o644)
            os.fsync(fd)
            written = os.fstat(fd)
            temp_named = os.stat(temporary, dir_fd=parent_fd, follow_symlinks=False)
            if (written.st_uid != 0 or written.st_nlink != 1
                    or stat.S_IMODE(written.st_mode) != 0o644
                    or (written.st_dev, written.st_ino) != (temp_named.st_dev, temp_named.st_ino)):
                raise BuilderRejected("seed mount unit temporary inode is unsafe")
        finally:
            os.close(fd)
        rename_noreplace(parent_fd, temporary, path.name)
        os.fsync(parent_fd)
        installed = os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False)
        if (not stat.S_ISREG(installed.st_mode) or installed.st_uid != 0
                or installed.st_nlink != 1 or stat.S_IMODE(installed.st_mode) != 0o644
                or (installed.st_dev, installed.st_ino) != (written.st_dev, written.st_ino)):
            raise BuilderRejected("seed mount unit publication changed identity")
        return True
    finally:
        os.close(parent_fd)


def _verify_mount(runner: Callable[..., object], *, image_identity: tuple[int, int]) -> None:
    verify_bounded_seed_workspace(runner=runner, image_identity=image_identity)


def _secure_mounted_root() -> None:
    fd = os.open(WORK_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if not stat.S_ISDIR(before.st_mode) or before.st_uid != 0 or not os.path.ismount(WORK_ROOT):
            raise BuilderRejected("seed workspace root is not the mounted root directory")
        os.fchown(fd, 0, 0)
        os.fchmod(fd, 0o700)
        os.fsync(fd)
        after = os.fstat(fd)
        named = WORK_ROOT.lstat()
        if ((after.st_dev, after.st_ino, after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode))
                != (before.st_dev, before.st_ino, 0, 0, 0o700)
                or (named.st_dev, named.st_ino) != (after.st_dev, after.st_ino)):
            raise BuilderRejected("seed workspace root ownership or mode did not settle")
    finally:
        os.close(fd)


def provision(*, runner: Callable[..., object] = subprocess.run,
              fallocate: Callable[[int, int, int], None] | None = None) -> None:
    from worker_release_seed_workspace_provision import provision_seed_workspace

    provision_seed_workspace(runner=runner, fallocate=fallocate)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="explicitly allocate, format and mount the fixed image")
    args = parser.parse_args(argv)
    try:
        print("Seed generation workspace plan:")
        for item in (
            f"Preflight at least {MIN_FREE_BYTES} available bytes and {MIN_HOST_FREE_INODES} inodes",
            f"Allocate {IMAGE_BYTES} bytes at {IMAGE}; format ext4 with {INODE_COUNT} inodes",
            f"Mount only at {WORK_ROOT} using {MOUNT_OPTIONS}",
            "Validate loop backing file, filesystem size, options, owner, group and mode",
        ):
            print(f"- {item}")
        if args.apply:
            provision()
            print("Bounded seed-generation filesystem provisioned and verified.")
        return 0
    except (BuilderRejected, OSError, subprocess.SubprocessError) as error:
        print(f"Seed workspace provisioning refused: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
