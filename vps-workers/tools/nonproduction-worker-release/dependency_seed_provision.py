"""Dry-run-first provisioning of the protected per-SHA seed publication root.

This creates only the fixed root and its empty publication lock. It does not
download packages, verify source provenance, preverify pnpm, or publish seeds.
"""
from __future__ import annotations

import argparse
import fcntl
import os
import stat
import sys
from pathlib import Path
from typing import Sequence

TOOLS = Path(__file__).resolve().parent
BIN = TOOLS.parents[1] / "bin"
sys.path.insert(0, str(BIN))

from worker_release_dependency_seed_consumer import SEED_ROOT  # noqa: E402
from worker_release_dependency_artifacts import BuilderRejected  # noqa: E402

ROOT_MODE = 0o700
PARENT_CREATE_MODE = 0o755
LOCK_NAME = ".publish.lock"
LOCK_MODE = 0o600
DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
FILE_FLAGS = os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)


class SeedProvisionRejected(BuilderRejected):
    """The fixed seed root or its publisher lock is unsafe or unavailable."""


def _validate_directory(fd: int, *, owner_uid: int, exact_mode: int | None = None) -> os.stat_result:
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or info.st_mode & 0o022
            or (exact_mode is not None and stat.S_IMODE(info.st_mode) != exact_mode)):
        raise SeedProvisionRejected("dependency seed directory ownership or mode is unsafe")
    return info


def _open_root_anchor(owner_uid: int) -> int:
    """Open /var/cache via a no-follow descriptor walk, validating every ancestor."""
    fd = os.open("/", DIR_FLAGS)
    try:
        _validate_directory(fd, owner_uid=owner_uid)
        for component in SEED_ROOT.parent.parent.parts[1:]:
            try:
                child = os.open(component, DIR_FLAGS, dir_fd=fd)
            except OSError as error:
                raise SeedProvisionRejected(
                    "dependency seed cache ancestor is unavailable or unsafe") from error
            try:
                _validate_directory(child, owner_uid=owner_uid)
            except BaseException:
                os.close(child)
                raise
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _ensure_child_directory(parent_fd: int, name: str, *, owner_uid: int,
                             create_mode: int, exact_mode: int | None = None) -> int:
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise SeedProvisionRejected("dependency seed path component is invalid")
    created = False
    try:
        fd = os.open(name, DIR_FLAGS, dir_fd=parent_fd)
    except FileNotFoundError:
        try:
            os.mkdir(name, create_mode, dir_fd=parent_fd)
        except FileExistsError:
            pass
        except OSError as error:
            raise SeedProvisionRejected("dependency seed directory could not be created") from error
        try:
            fd = os.open(name, DIR_FLAGS, dir_fd=parent_fd)
        except OSError as error:
            raise SeedProvisionRejected("dependency seed directory could not be pinned") from error
        created = True
    except OSError as error:
        raise SeedProvisionRejected("dependency seed directory is not a safe directory") from error
    try:
        if created:
            # Only newly created directories may be adjusted to their declared mode.
            if os.fstat(fd).st_uid != owner_uid:
                os.fchown(fd, owner_uid, -1)
            os.fchmod(fd, create_mode)
        _validate_directory(fd, owner_uid=owner_uid,
                            exact_mode=exact_mode if exact_mode is not None else (
                                create_mode if created else None))
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        opened = os.fstat(fd)
        if (not stat.S_ISDIR(named.st_mode)
                or (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino)):
            raise SeedProvisionRejected("dependency seed directory name changed")
        if created:
            os.fsync(parent_fd)
        return fd
    except BaseException:
        os.close(fd)
        raise


def _ensure_lock(root_fd: int, *, owner_uid: int) -> None:
    created = False
    try:
        lock_fd = os.open(LOCK_NAME, FILE_FLAGS | os.O_CREAT | os.O_EXCL, LOCK_MODE,
                          dir_fd=root_fd)
        created = True
    except FileExistsError:
        try:
            lock_fd = os.open(LOCK_NAME, FILE_FLAGS, dir_fd=root_fd)
        except OSError as error:
            raise SeedProvisionRejected("dependency seed publication lock is unsafe") from error
    except OSError as error:
        raise SeedProvisionRejected("dependency seed publication lock could not be created") from error
    try:
        if created:
            if os.fstat(lock_fd).st_uid != owner_uid:
                os.fchown(lock_fd, owner_uid, -1)
            os.fchmod(lock_fd, LOCK_MODE)
        info = os.fstat(lock_fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner_uid
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != LOCK_MODE
                or info.st_size != 0):
            raise SeedProvisionRejected("dependency seed publication lock inode is unsafe")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SeedProvisionRejected("dependency seed publication is already active") from error
        named = os.stat(LOCK_NAME, dir_fd=root_fd, follow_symlinks=False)
        after_lock = os.fstat(lock_fd)
        if (not stat.S_ISREG(named.st_mode) or after_lock.st_uid != owner_uid
                or after_lock.st_nlink != 1 or stat.S_IMODE(after_lock.st_mode) != LOCK_MODE
                or after_lock.st_size != 0
                or (after_lock.st_dev, after_lock.st_ino) != (info.st_dev, info.st_ino)
                or (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino)):
            raise SeedProvisionRejected("dependency seed publication lock name changed")
        if created:
            os.fsync(lock_fd)
            os.fsync(root_fd)
    finally:
        os.close(lock_fd)


def provision_seed_root() -> Path:
    """Create/validate the fixed root and lock without touching existing seeds."""
    owner_uid = os.geteuid()
    if owner_uid != 0:
        raise SeedProvisionRejected("seed-root provisioning requires root")
    anchor_fd = _open_root_anchor(owner_uid)
    parent_fd = root_fd = -1
    try:
        parent_fd = _ensure_child_directory(
            anchor_fd, SEED_ROOT.parent.name, owner_uid=owner_uid,
            create_mode=PARENT_CREATE_MODE,
        )
        root_fd = _ensure_child_directory(
            parent_fd, SEED_ROOT.name, owner_uid=owner_uid,
            create_mode=ROOT_MODE, exact_mode=ROOT_MODE,
        )
        _ensure_lock(root_fd, owner_uid=owner_uid)
        named_root = os.stat(SEED_ROOT.name, dir_fd=parent_fd, follow_symlinks=False)
        opened_root = os.fstat(root_fd)
        if (not stat.S_ISDIR(named_root.st_mode)
                or (named_root.st_dev, named_root.st_ino) !=
                   (opened_root.st_dev, opened_root.st_ino)):
            raise SeedProvisionRejected("dependency seed root path changed")
        named_parent = os.stat(SEED_ROOT.parent.name, dir_fd=anchor_fd,
                               follow_symlinks=False)
        opened_parent = os.fstat(parent_fd)
        if (not stat.S_ISDIR(named_parent.st_mode)
                or (named_parent.st_dev, named_parent.st_ino) !=
                   (opened_parent.st_dev, opened_parent.st_ino)):
            raise SeedProvisionRejected("dependency seed parent path changed")
        named_anchor = os.stat(SEED_ROOT.parent.parent, follow_symlinks=False)
        opened_anchor = os.fstat(anchor_fd)
        if ((named_anchor.st_dev, named_anchor.st_ino) !=
                (opened_anchor.st_dev, opened_anchor.st_ino)):
            raise SeedProvisionRejected("dependency seed cache anchor changed")
        return SEED_ROOT
    finally:
        if root_fd >= 0:
            os.close(root_fd)
        if parent_fd >= 0:
            os.close(parent_fd)
        os.close(anchor_fd)


def plan() -> tuple[str, ...]:
    return (
        f"Validate root-owned, non-writable ancestry to {SEED_ROOT.parent.parent}",
        f"Create {SEED_ROOT.parent} as root:root mode 0755 only if absent",
        f"Create {SEED_ROOT} as root:root mode 0700 only if absent",
        f"Create {SEED_ROOT / LOCK_NAME} as an empty root:root regular file mode 0600 only if absent",
        "Verify publisher lock is not held; preserve all existing per-SHA entries",
        "No source authentication, pnpm preverification, download, seed publication, or unit activation",
    )


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="provision the fixed root and empty publisher lock")
    args = parser.parse_args(argv)
    if not args.apply:
        for line in plan():
            print(line)
        return 0
    try:
        path = provision_seed_root()
        print(f"Protected dependency seed root and publisher lock provisioned: {path}")
        print("No seed was authenticated, downloaded, preverified, or published.")
        return 0
    except Exception as error:
        print(f"dependency seed-root provisioning refused: {type(error).__name__}",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
