"""Persistent systemd mount provisioning for the fixed dependency build root.

The device must already be partitioned and formatted. This module never formats
storage and refuses all host changes while the measured graph floor exceeds the
configured filesystem ceiling.
"""
from __future__ import annotations

import os
import re
import stat
import subprocess
import grp
import argparse
import json
from pathlib import Path
from typing import Callable

from worker_release_dependency_builder import (
    BUILD_ROOT, MAX_BUILD_FILESYSTEM_BYTES, MIN_BUILD_FILESYSTEM_BYTES,
)
from worker_release_dependency_artifacts import BuilderRejected

SYSTEMD_UNIT_DIR = Path("/etc/systemd/system")
UNIT_NAME = r"run-baci\x2dworker\x2drelease\x2dbuild.mount"
DEVICE_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _observed_graph_floor() -> int:
    """Read the same evidence floor enforced by the current builder provisioner."""
    import importlib.util
    script = Path(__file__).with_name("provision-worker-dependency-builder.py")
    spec = importlib.util.spec_from_file_location("provision_worker_dependency_builder_floor", script)
    if spec is None or spec.loader is None:
        raise BuilderRejected("dependency graph capacity evidence is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    floor = getattr(module, "OBSERVED_GRAPH_FLOOR_BYTES", None)
    if type(floor) is not int or floor <= 0:
        raise BuilderRejected("dependency graph capacity evidence is invalid")
    return floor


def require_capacity_policy(*, minimum: int = MIN_BUILD_FILESYSTEM_BYTES,
                            maximum: int = MAX_BUILD_FILESYSTEM_BYTES,
                            observed_floor: int | None = None) -> None:
    floor = _observed_graph_floor() if observed_floor is None else observed_floor
    if (type(minimum) is not int or type(maximum) is not int or type(floor) is not int
            or minimum <= 0 or maximum <= minimum or floor <= 0 or maximum <= floor):
        raise BuilderRejected("builder mount is blocked by the measured dependency graph capacity floor")


def mount_unit_contents(device_uuid: str, *, target: Path = BUILD_ROOT) -> bytes:
    if not isinstance(device_uuid, str) or DEVICE_UUID_RE.fullmatch(device_uuid) is None:
        raise BuilderRejected("builder mount device UUID is malformed")
    if target != BUILD_ROOT:
        raise BuilderRejected("builder mount target differs from fixed policy")
    text = f"""[Unit]
Description=Bounded Baci worker dependency build filesystem
Before=local-fs.target

[Mount]
What=/dev/disk/by-uuid/{device_uuid.lower()}
Where={BUILD_ROOT}
Type=ext4
Options=nosuid,nodev,noexec
DirectoryMode=0755
TimeoutSec=30s

[Install]
WantedBy=local-fs.target
"""
    return text.encode("ascii")


def _write_new_unit(unit_path: Path, payload: bytes) -> None:
    parent_info = unit_path.parent.lstat()
    if (not stat.S_ISDIR(parent_info.st_mode) or parent_info.st_uid != 0
            or parent_info.st_mode & 0o022):
        raise BuilderRejected("systemd unit directory ownership or mode is unsafe")
    try:
        existing = unit_path.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None:
        if (not stat.S_ISREG(existing.st_mode) or existing.st_uid != 0
                or existing.st_nlink != 1 or stat.S_IMODE(existing.st_mode) != 0o644
                or unit_path.read_bytes() != payload):
            raise BuilderRejected("existing builder mount unit is not the exact fixed unit")
        return
    temporary = unit_path.parent / f".{unit_path.name}.{os.getpid()}.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise BuilderRejected("builder mount unit write was incomplete")
            view = view[written:]
        os.fchmod(fd, 0o644)
        os.fsync(fd)
    except BaseException:
        os.close(fd)
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    os.close(fd)
    try:
        os.link(temporary, unit_path, follow_symlinks=False)
        os.unlink(temporary)
        parent_fd = os.open(unit_path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _unit_properties(runner: Callable[..., object], unit: str) -> dict[str, str]:
    properties = ("What", "Where", "Type", "Options")
    result = {}
    for name in properties:
        completed = runner(("/usr/bin/systemctl", "show", f"--property={name}",
                            "--value", unit), check=True, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                           env={"PATH": "/usr/bin:/bin"})
        result[name] = completed.stdout.strip()
    return result


def _active_mount_matches(runner: Callable[..., object], target: Path,
                          device_uuid: str) -> bool:
    try:
        completed = runner(("/usr/bin/findmnt", "--noheadings", "--raw", "--output",
                            "UUID,FSTYPE,OPTIONS,TARGET", "--target", str(target)),
                           check=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL, text=True,
                           env={"PATH": "/usr/bin:/bin"})
    except (OSError, subprocess.SubprocessError):
        return False
    fields = completed.stdout.strip().split()
    if len(fields) != 4:
        return False
    uuid_value, filesystem, options, mounted_target = fields
    actual_options = set(options.split(","))
    return (uuid_value.lower() == device_uuid.lower() and filesystem == "ext4"
            and {"nosuid", "nodev", "noexec"}.issubset(actual_options)
            and mounted_target == str(target))


def _prepare_mount_root(target: Path) -> None:
    try:
        worker_gid = grp.getgrnam("baci-release-build").gr_gid
    except KeyError as error:
        raise BuilderRejected("isolated dependency-builder group is not provisioned") from error
    fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        names = os.listdir(fd)
        if names:
            if names != ["lost+found"]:
                raise BuilderRejected("new builder filesystem contains unexpected prior data")
            child_fd = os.open("lost+found", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=fd)
            try:
                child = os.fstat(child_fd)
                if (not stat.S_ISDIR(child.st_mode) or child.st_uid != 0
                        or child.st_mode & 0o077 or os.listdir(child_fd)):
                    raise BuilderRejected("builder filesystem recovery directory is unsafe")
            finally:
                os.close(child_fd)
        if before.st_uid != 0:
            raise BuilderRejected("builder filesystem root is not root-owned")
        os.fchown(fd, 0, worker_gid)
        os.fchmod(fd, 0o710)
        after = os.fstat(fd)
        path_after = target.lstat()
        if ((after.st_dev, after.st_ino, after.st_uid, after.st_gid,
             stat.S_IMODE(after.st_mode)) != (before.st_dev, before.st_ino, 0, worker_gid, 0o710)
                or (path_after.st_dev, path_after.st_ino) != (after.st_dev, after.st_ino)):
            raise BuilderRejected("builder filesystem root did not settle to the fixed ownership contract")
    finally:
        os.close(fd)


def install_builder_mount(device_uuid: str, *, runner: Callable[..., object] | None = None,
                          unit_dir: Path = SYSTEMD_UNIT_DIR,
                          target: Path = BUILD_ROOT) -> None:
    """Install and enable the persistent mount after exact policy prechecks."""
    require_capacity_policy()
    if os.geteuid() != 0:
        raise BuilderRejected("builder mount provisioning requires root")
    if target != BUILD_ROOT or unit_dir != SYSTEMD_UNIT_DIR:
        raise BuilderRejected("builder mount paths differ from fixed host policy")
    payload = mount_unit_contents(device_uuid, target=target)
    unit_path = unit_dir / UNIT_NAME
    _write_new_unit(unit_path, payload)
    run = runner or subprocess.run
    run(("/usr/bin/systemctl", "daemon-reload"), check=True, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin"})
    run(("/usr/bin/systemctl", "enable", "--now", UNIT_NAME), check=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        env={"PATH": "/usr/bin:/bin"})
    observed = _unit_properties(run, UNIT_NAME)
    expected = {
        "What": f"/dev/disk/by-uuid/{device_uuid.lower()}",
        "Where": str(BUILD_ROOT), "Type": "ext4", "Options": "nosuid,nodev,noexec",
    }
    if (observed != expected or not os.path.ismount(BUILD_ROOT)
            or not _active_mount_matches(run, BUILD_ROOT, device_uuid)):
        raise BuilderRejected("active builder mount differs from the fixed persistent unit")
    filesystem = os.statvfs(BUILD_ROOT)
    capacity = filesystem.f_blocks * filesystem.f_frsize
    if not MIN_BUILD_FILESYSTEM_BYTES <= capacity <= MAX_BUILD_FILESYSTEM_BYTES:
        raise BuilderRejected("active builder mount capacity is outside fixed bounds")
    _prepare_mount_root(BUILD_ROOT)


__all__ = ["BuilderRejected", "DEVICE_UUID_RE", "UNIT_NAME", "install_builder_mount",
           "mount_unit_contents", "require_capacity_policy"]


def main(argv: list[str] | None = None) -> int:
    """Print a non-mutating plan by default; activation requires explicit opt-in."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device-uuid", required=True,
                        help="UUID of the already formatted, dedicated ext4 partition")
    parser.add_argument("--apply", action="store_true",
                        help="write and enable the fixed systemd mount unit")
    args = parser.parse_args(argv)
    try:
        unit = mount_unit_contents(args.device_uuid)
        require_capacity_policy()
        if args.apply:
            install_builder_mount(args.device_uuid)
        else:
            print(json.dumps({"status": "planned", "unit": UNIT_NAME,
                              "mountTarget": str(BUILD_ROOT),
                              "filesystem": "ext4", "options": ["nosuid", "nodev", "noexec"],
                              "unitBytes": len(unit)}, sort_keys=True))
        return 0
    except (BuilderRejected, OSError, subprocess.SubprocessError) as error:
        # Emit only a bounded fixed category. Host paths and command output are
        # not needed to decide whether provisioning is allowed.
        category = "capacity-policy-rejected" if "capacity" in str(error) else "provisioning-rejected"
        print(json.dumps({"status": "rejected", "category": category}, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
