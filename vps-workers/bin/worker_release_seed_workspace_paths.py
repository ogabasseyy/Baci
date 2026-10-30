"""Create only the fixed, empty seed-workspace parent directories."""
from __future__ import annotations

import ctypes
import os
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected


def rename_noreplace(parent_fd: int, source: str, destination: str) -> None:
    """Atomically publish a sibling name without overwriting an existing entry."""
    if (not source or not destination or source in {".", ".."} or destination in {".", ".."}
            or "/" in source or "/" in destination or "\\" in source or "\\" in destination):
        raise BuilderRejected("seed workspace atomic rename names are malformed")
    libc = ctypes.CDLL(None, use_errno=True)
    operation = getattr(libc, "renameat2", None)
    if operation is None:
        # macOS and older Linux lack renameat2. Link/unlink preserves
        # no-overwrite semantics; journal consumers must recognize the exact
        # two-name/same-inode crash window before removing the temporary link.
        os.link(source, destination, src_dir_fd=parent_fd, dst_dir_fd=parent_fd,
                follow_symlinks=False)
        os.unlink(source, dir_fd=parent_fd)
        return
    operation.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p,
                          ctypes.c_uint]
    operation.restype = ctypes.c_int
    result = operation(parent_fd, os.fsencode(source), parent_fd,
                       os.fsencode(destination), 1)  # RENAME_NOREPLACE
    if result != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), destination)


def _open_directory(parent_fd: int, name: str, *, owner_uid: int, mode: int) -> int:
    try:
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    except FileNotFoundError:
        os.mkdir(name, mode, dir_fd=parent_fd)
        os.fsync(parent_fd)
        fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid
            or stat.S_IMODE(info.st_mode) != mode):
        os.close(fd)
        raise BuilderRejected("seed workspace fixed directory has unsafe ownership or mode")
    return fd


def ensure_seed_workspace_directories(parent: Path, *, owner_uid: int = 0) -> tuple[tuple[int, int], tuple[int, int]]:
    """Create/validate release parent and empty mountpoint relative to a trusted parent fd."""
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parent_info = os.fstat(parent_fd)
        if (not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != owner_uid
                or parent_info.st_mode & 0o022):
            raise BuilderRejected("seed workspace creation parent is unsafe")
        release_fd = _open_directory(
            parent_fd, "baci-worker-release", owner_uid=owner_uid, mode=0o755,
        )
        try:
            release_info = os.fstat(release_fd)
            mount_fd = _open_directory(
                release_fd, "seed-work", owner_uid=owner_uid, mode=0o700,
            )
            try:
                if os.listdir(mount_fd):
                    raise BuilderRejected("seed workspace mountpoint is not empty before provisioning")
                mount_info = os.fstat(mount_fd)
                return ((release_info.st_dev, release_info.st_ino),
                        (mount_info.st_dev, mount_info.st_ino))
            finally:
                os.close(mount_fd)
        finally:
            os.close(release_fd)
    except FileExistsError as error:
        raise BuilderRejected("seed workspace fixed directory was concurrently created") from error
    except OSError as error:
        raise BuilderRejected("seed workspace fixed directory is unsafe") from error
    finally:
        os.close(parent_fd)


def ensure_seed_collection(mount_root: Path, *, owner_uid: int = 0) -> tuple[int, int]:
    """Create or validate the root-only seed collection inside the bounded mount."""
    root_fd = os.open(mount_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        root = os.fstat(root_fd)
        if (not stat.S_ISDIR(root.st_mode) or root.st_uid != owner_uid
                or stat.S_IMODE(root.st_mode) != 0o700):
            raise BuilderRejected("seed workspace mount root is unsafe")
        try:
            os.mkdir("seeds", 0o700, dir_fd=root_fd)
            os.fsync(root_fd)
        except FileExistsError:
            pass
        seeds_fd = os.open("seeds", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                           dir_fd=root_fd)
        try:
            seeds = os.fstat(seeds_fd)
            if (not stat.S_ISDIR(seeds.st_mode) or seeds.st_uid != owner_uid
                    or stat.S_IMODE(seeds.st_mode) != 0o700):
                raise BuilderRejected("seed collection root ownership or mode is unsafe")
            return seeds.st_dev, seeds.st_ino
        finally:
            os.close(seeds_fd)
    except OSError as error:
        raise BuilderRejected("seed collection root is unsafe") from error
    finally:
        os.close(root_fd)


def trusted_directory(path: Path, *, exact_mode: int | None = None,
                      require_empty: bool = False) -> os.stat_result:
    requested = Path(path)
    if not requested.is_absolute() or ".." in requested.parts:
        raise BuilderRejected("seed workspace path is not canonical")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in requested.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            info = os.fstat(child)
            if info.st_uid != 0 or info.st_mode & 0o022:
                os.close(child)
                raise BuilderRejected("seed workspace path ancestry is not root-owned")
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        if (info.st_uid != 0 or info.st_mode & 0o022
                or exact_mode is not None and stat.S_IMODE(info.st_mode) != exact_mode):
            raise BuilderRejected("seed workspace parent or mountpoint permissions are unsafe")
        if require_empty and os.listdir(fd):
            raise BuilderRejected("seed workspace mountpoint is not empty before provisioning")
        return info
    finally:
        os.close(fd)
