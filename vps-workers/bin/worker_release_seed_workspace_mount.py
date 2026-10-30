"""Read-only proof that seed state resides on the fixed bounded loop mount."""
from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected

IMAGE = Path("/var/cache/baci-worker-release/seed-work.img")
WORK_ROOT = Path("/var/cache/baci-worker-release/seed-work")
SEED_ROOT = WORK_ROOT / "seeds"
UNIT_NAME = "var-cache-baci\\x2dworker\\x2drelease-seed\\x2dwork.mount"
IMAGE_BYTES = 32 * 1024**3
INODE_COUNT = 2_000_000
EXPECTED_OBSERVED_BYTES = 14_771_000_000
MIN_USABLE_CAPACITY_BYTES = EXPECTED_OBSERVED_BYTES * 2
MOUNT_OPTIONS = "loop,nosuid,nodev,noexec"
LOOP_RE = re.compile(r"^/dev/loop[0-9]+$")


def verify_bounded_seed_workspace(*, runner: Callable[..., object] = subprocess.run,
                                  image_identity: tuple[int, int] | None = None) -> tuple[int, int]:
    """Prove the fixed seed child is on the exact bounded ext4 loop mount."""
    if os.geteuid() != 0 or not os.path.ismount(WORK_ROOT):
        raise BuilderRejected("fixed seed workspace is not mounted by the privileged provisioner")
    _trusted_directory_chain(WORK_ROOT)
    _trusted_directory_chain(IMAGE.parent)
    image = IMAGE.lstat()
    if (not stat.S_ISREG(image.st_mode) or image.st_uid != 0 or image.st_nlink != 1
            or stat.S_IMODE(image.st_mode) != 0o600 or image.st_size != IMAGE_BYTES
            or (image_identity is not None
                and (image.st_dev, image.st_ino) != image_identity)):
        raise BuilderRejected("fixed seed workspace image identity is unsafe")

    # The active unit may expose a resolved loop device as What, and loop= is
    # consumed while setting that device up. Verify the effective source and
    # mount flags below instead of requiring configured strings verbatim.
    properties = {
        key: _query(runner, ("/usr/bin/systemctl", "show", f"--property={key}",
                             "--value", UNIT_NAME), timeout=3)
        for key in ("Where", "Type", "ActiveState")
    }
    if properties != {"Where": str(WORK_ROOT), "Type": "ext4", "ActiveState": "active"}:
        raise BuilderRejected("fixed seed workspace systemd mount contract differs")

    mount = _query(runner, ("/usr/bin/findmnt", "--noheadings", "--raw", "--output",
                            "SOURCE,FSTYPE,OPTIONS,TARGET", "--target", str(WORK_ROOT)),
                   timeout=3).split()
    if len(mount) != 4:
        raise BuilderRejected("fixed seed workspace mount metadata is malformed")
    source, filesystem, options, target = mount
    option_set = set(options.split(","))
    if (not LOOP_RE.fullmatch(source) or filesystem != "ext4" or target != str(WORK_ROOT)
            or not {"nosuid", "nodev", "noexec"}.issubset(option_set)
            or option_set.intersection({"suid", "dev", "exec"})):
        raise BuilderRejected("fixed seed workspace mount source or options are unsafe")
    loop = _query(runner, ("/usr/sbin/losetup", "--noheadings", "--raw", "--output",
                           "BACK-FILE,SIZELIMIT", source), timeout=3).split()
    if loop != [str(IMAGE), "0"]:
        raise BuilderRejected("fixed seed workspace loop backing file differs")

    root_fd = _open_fixed_directory(WORK_ROOT)
    try:
        root = os.fstat(root_fd)
        path_root = WORK_ROOT.lstat()
        if ((root.st_dev, root.st_ino, root.st_uid, stat.S_IMODE(root.st_mode))
                != (path_root.st_dev, path_root.st_ino, 0, 0o700)):
            raise BuilderRejected("fixed seed workspace mount root metadata is unsafe")
        seed_fd = os.open("seeds", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=root_fd)
        try:
            seeds = os.fstat(seed_fd)
            named = os.stat("seeds", dir_fd=root_fd, follow_symlinks=False)
            if (not stat.S_ISDIR(seeds.st_mode) or seeds.st_uid != 0
                    or stat.S_IMODE(seeds.st_mode) != 0o700
                    or (seeds.st_dev, seeds.st_ino) != (named.st_dev, named.st_ino)):
                raise BuilderRejected("fixed per-SHA seed root is not the protected mount child")
        finally:
            os.close(seed_fd)
    finally:
        os.close(root_fd)

    fs = os.statvfs(WORK_ROOT)
    capacity = fs.f_blocks * fs.f_frsize
    # ext4 statvfs excludes filesystem metadata from f_blocks, unlike the
    # raw filesystem geometry. Require the planned twofold workload headroom,
    # and never let reported usable capacity exceed the fixed image ceiling.
    if not MIN_USABLE_CAPACITY_BYTES <= capacity <= IMAGE_BYTES:
        raise BuilderRejected("fixed seed workspace byte quota differs from policy")
    details = _query(runner, ("/usr/sbin/tune2fs", "-l", str(IMAGE)), timeout=5)
    geometry = _geometry(details)
    if (geometry["inodes"] < INODE_COUNT
            or not IMAGE_BYTES * 99 // 100 <= geometry["bytes"] <= IMAGE_BYTES * 101 // 100):
        raise BuilderRejected("fixed seed workspace inode or filesystem quota differs")
    return capacity, geometry["inodes"]


def _trusted_directory_chain(path: Path) -> None:
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in path.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            info = os.fstat(child)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                os.close(child)
                raise BuilderRejected("fixed seed workspace ancestry is unsafe")
            os.close(fd)
            fd = child
    except OSError as error:
        raise BuilderRejected("fixed seed workspace ancestry cannot be pinned") from error
    finally:
        os.close(fd)


def _open_fixed_directory(path: Path) -> int:
    _trusted_directory_chain(path)
    return os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)


def _query(runner: Callable[..., object], args: tuple[str, ...], *, timeout: float) -> str:
    try:
        result = runner(args, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL, timeout=timeout, text=True,
                        env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.SubprocessError) as error:
        raise BuilderRejected("fixed seed workspace mount proof is unavailable") from error
    if not isinstance(result.stdout, str) or len(result.stdout) > 16_384:
        raise BuilderRejected("fixed seed workspace mount proof output is malformed")
    return result.stdout.strip()


def _geometry(output: str) -> dict[str, int]:
    values = {}
    for line in output.splitlines():
        key, separator, value = line.partition(":")
        if separator and key.strip() in {"Inode count", "Block count", "Block size"}:
            try:
                values[key.strip()] = int(value.strip())
            except ValueError as error:
                raise BuilderRejected("fixed seed workspace geometry is malformed") from error
    try:
        return {"inodes": values["Inode count"],
                "bytes": values["Block count"] * values["Block size"]}
    except KeyError as error:
        raise BuilderRejected("fixed seed workspace geometry is unavailable") from error
