#!/usr/bin/env python3
"""Dry-run-first provisioning for the isolated dependency builder.

With an explicit UUID, --apply can install and enable the fixed persistent
mount for an already formatted ext4 device, provision the isolated identity,
and create the protected seed publication root and empty lock. It never formats
storage, generates/authenticates/downloads/preverifies/publishes a seed, or
activates the builder service. The mount and builder capacity policy must pass
before host mutation. `--check --source-sha` checks only the requested seed
entry identity; the builder verifies complete source binding again.
"""
from __future__ import annotations

import argparse
import grp
import os
import pwd
import re
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable, Sequence

_SEED_TOOLS = Path(__file__).resolve().parents[1] / "tools" / "nonproduction-worker-release"
sys.path.insert(0, str(_SEED_TOOLS))

from worker_release_dependency_builder import (
    BUILD_ROOT, BUILD_RESULTS_ROOT, MAX_BUILD_FILESYSTEM_BYTES,
    MIN_BUILD_FILESYSTEM_BYTES,
)
from worker_release_dependency_policy_cache import EXPECTED_PNPM
from worker_release_dependency_seed_consumer import SEED_MANIFEST, SEED_ROOT
import dependency_seed_provision
import worker_release_dependency_mount_provision
import worker_release_seed_readiness as seed_readiness

USER = GROUP = "baci-release-build"
WORKER = "baci-worker"
NOLOGIN = "/usr/sbin/nologin"
HOME = "/nonexistent"
OBSERVED_GRAPH_FLOOR_BYTES = int(5.1 * 1024 ** 3)


class ProvisionRejected(RuntimeError):
    """Required builder prerequisites are missing or unsafe."""


def _seed_ready(source_sha: str | None, *, seed_root: Path = SEED_ROOT,
                owner_uid: int = 0) -> None:
    try:
        seed_readiness.seed_ready(source_sha, seed_root=seed_root, owner_uid=owner_uid)
    except seed_readiness.SeedReadinessRejected as error:
        raise ProvisionRejected(str(error)) from error


def _mounted_build_root(*, path: Path = BUILD_ROOT, gid: int | None = None) -> None:
    if MAX_BUILD_FILESYSTEM_BYTES <= OBSERVED_GRAPH_FLOOR_BYTES:
        raise ProvisionRejected(
            "configured build filesystem cap is below the observed dependency graph footprint"
        )
    try:
        info = path.lstat()
        filesystem = os.statvfs(path)
    except OSError as error:
        raise ProvisionRejected("bounded build filesystem is unavailable") from error
    capacity = filesystem.f_blocks * filesystem.f_frsize
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
            or (gid is not None and info.st_gid != gid)
            or stat.S_IMODE(info.st_mode) != 0o710 or not os.path.ismount(path)
            or capacity < MIN_BUILD_FILESYSTEM_BYTES
            or capacity > MAX_BUILD_FILESYSTEM_BYTES):
        raise ProvisionRejected("build path is not the fixed bounded root-owned mount")


def _identity_state() -> tuple[bool, bool]:
    try:
        grp.getgrnam(GROUP)
        group_exists = True
    except KeyError:
        group_exists = False
    try:
        pwd.getpwnam(USER)
        user_exists = True
    except KeyError:
        user_exists = False
    if group_exists != user_exists:
        raise ProvisionRejected("partial dependency-builder identity exists")
    return group_exists, user_exists


def _validate_identity() -> tuple[int, int]:
    try:
        group, user = grp.getgrnam(GROUP), pwd.getpwnam(USER)
        worker = pwd.getpwnam(WORKER)
        lock_gid = grp.getgrnam("baci-locks").gr_gid
    except KeyError as error:
        raise ProvisionRejected("dependency builder or worker identity is missing") from error
    members = pwd.getpwall()
    groups = grp.getgrall()
    supplementary = os.getgrouplist(USER, user.pw_gid)
    if (user.pw_uid <= 0 or user.pw_uid == worker.pw_uid or user.pw_gid != group.gr_gid
            or user.pw_shell != NOLOGIN or user.pw_dir != HOME or group.gr_mem
            or supplementary != [group.gr_gid] or lock_gid in supplementary
            or any(item.pw_uid == user.pw_uid and item.pw_name != USER for item in members)
            or any(item.pw_gid == group.gr_gid and item.pw_name != USER for item in members)
            or any(item.gr_gid == group.gr_gid and item.gr_name != GROUP for item in groups)):
        raise ProvisionRejected("dependency-builder identity violates the fixed isolated contract")
    return user.pw_uid, group.gr_gid


def _set_build_root_group(gid: int) -> None:
    """Set only the verified mount root's group through its pinned directory fd."""
    _mounted_build_root()
    fd = os.open(BUILD_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        path_info = BUILD_ROOT.lstat()
        if ((before.st_dev, before.st_ino) != (path_info.st_dev, path_info.st_ino)
                or before.st_uid != 0 or stat.S_IMODE(before.st_mode) != 0o710):
            raise ProvisionRejected("build mount root changed during ownership validation")
        if before.st_gid != gid:
            os.fchown(fd, 0, gid)
        after = os.fstat(fd)
        path_after = BUILD_ROOT.lstat()
        if ((after.st_dev, after.st_ino, after.st_uid, after.st_gid,
             stat.S_IMODE(after.st_mode)) != (before.st_dev, before.st_ino, 0, gid, 0o710)
                or (path_after.st_dev, path_after.st_ino) != (after.st_dev, after.st_ino)):
            raise ProvisionRejected("build mount ownership did not settle to the fixed contract")
    finally:
        os.close(fd)


def _validate_result_root(gid: int) -> None:
    try:
        info = BUILD_RESULTS_ROOT.lstat()
    except OSError as error:
        raise ProvisionRejected("builder result root is unavailable") from error
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise ProvisionRejected("builder result root ownership or mode is unsafe")


def _validate_lost_found() -> bool:
    """Accept only the empty root-owned recovery directory created by ext4."""
    path = BUILD_ROOT / "lost+found"
    try:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return False
    try:
        info = os.fstat(fd)
        named = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                or stat.S_IMODE(info.st_mode) != 0o700 or os.listdir(fd)
                or (info.st_dev, info.st_ino) != (named.st_dev, named.st_ino)):
            raise ProvisionRejected("builder ext4 recovery directory is unsafe")
        return True
    except OSError as error:
        raise ProvisionRejected("builder ext4 recovery directory is unavailable") from error
    finally:
        os.close(fd)


def validate_prerequisites(source_sha: str | None = None) -> tuple[int, int]:
    _seed_ready(source_sha)
    _mounted_build_root()
    uid, gid = _validate_identity()
    _mounted_build_root(gid=gid)
    _validate_result_root(gid)
    return uid, gid


def plan(device_uuid: str | None = None) -> tuple[str, ...]:
    """Describe the complete provisioning path without performing host writes."""
    lines = [
        f"Create the isolated {GROUP} group and {USER} no-login account if both are absent",
        "Require the capacity policy to clear before any mutation",
    ]
    if device_uuid is None:
        lines.append("Blocked: provide --device-uuid for the already formatted dedicated ext4 partition")
    else:
        unit = worker_release_dependency_mount_provision.mount_unit_contents(device_uuid)
        lines.extend((
            f"Install and enable the fixed persistent systemd mount at {BUILD_ROOT}",
            f"Mount policy: ext4 nosuid,nodev,noexec; unit payload is {len(unit)} bytes",
        ))
    lines.extend((
        f"Create and validate root-owned result directory {BUILD_RESULTS_ROOT} mode 0700",
        f"Provision only the protected per-SHA seed root {SEED_ROOT} and empty publisher lock",
        "Do not generate, authenticate, download, preverify, or publish a dependency seed",
        "Do not activate the dependency-builder service",
    ))
    return tuple(lines)


def apply(*, device_uuid: str, runner: Callable[..., object] | None = None,
          mount_installer: Callable[..., object] | None = None,
          seed_provisioner: Callable[[], object] | None = None) -> None:
    if os.geteuid() != 0:
        raise ProvisionRejected("--apply requires root")
    try:
        worker_release_dependency_mount_provision.require_capacity_policy()
    except Exception as error:
        raise ProvisionRejected("builder capacity policy is not satisfied") from error
    # UUID validation happens before account or filesystem changes.
    worker_release_dependency_mount_provision.mount_unit_contents(device_uuid)
    if not isinstance(device_uuid, str) or worker_release_dependency_mount_provision.DEVICE_UUID_RE.fullmatch(device_uuid) is None:
        raise ProvisionRejected("builder mount device UUID is malformed")
    run = runner or subprocess.run
    group_exists, user_exists = _identity_state()
    if not group_exists:
        run(("groupadd", "--system", GROUP), check=True, stdin=subprocess.DEVNULL)
        run(("useradd", "--system", "--gid", GROUP, "--home-dir", HOME,
             "--no-create-home", "--shell", NOLOGIN, USER), check=True,
            stdin=subprocess.DEVNULL)
    elif not user_exists:
        # _identity_state rejects this combination; retained for type clarity.
        raise ProvisionRejected("partial dependency-builder identity exists")
    install_mount = mount_installer or worker_release_dependency_mount_provision.install_builder_mount
    install_mount(device_uuid, runner=run)
    _mounted_build_root()
    root_entries = {entry.name for entry in BUILD_ROOT.iterdir()}
    allowed = {"results", ".builder.lock", "lost+found"}
    if root_entries - allowed:
        raise ProvisionRejected("builder mount contains unrecognized prior state")
    has_lost_found = _validate_lost_found()
    if "results" in root_entries and any((BUILD_ROOT / "results").iterdir()):
        raise ProvisionRejected("builder result root contains unclaimed prior artifacts")
    uid, gid = _validate_identity()
    _set_build_root_group(gid)
    try:
        results = BUILD_RESULTS_ROOT.lstat()
    except FileNotFoundError:
        os.mkdir(BUILD_RESULTS_ROOT, 0o700)
        os.chown(BUILD_RESULTS_ROOT, 0, gid)
        os.chmod(BUILD_RESULTS_ROOT, 0o700)
        results = BUILD_RESULTS_ROOT.lstat()
    if (not stat.S_ISDIR(results.st_mode) or results.st_uid != 0
            or results.st_gid != gid or stat.S_IMODE(results.st_mode) != 0o700):
        raise ProvisionRejected("builder mount contains unexpected or unsafe prior state")
    if ".builder.lock" in root_entries:
        lock = (BUILD_ROOT / ".builder.lock").lstat()
        if (not stat.S_ISREG(lock.st_mode) or lock.st_uid != 0 or lock.st_nlink != 1
                or stat.S_IMODE(lock.st_mode) != 0o600):
            raise ProvisionRejected("builder lock inode is unsafe")
    provision_seed_root = seed_provisioner or dependency_seed_provision.provision_seed_root
    provision_seed_root()
    expected_entries = ({"results"} | ({".builder.lock"} if ".builder.lock" in root_entries else set())
                        | ({"lost+found"} if has_lost_found else set()))
    if {entry.name for entry in BUILD_ROOT.iterdir()} != expected_entries:
        raise ProvisionRejected("builder mount contents changed during provisioning")
    if ".builder.lock" in root_entries:
        lock = (BUILD_ROOT / ".builder.lock").lstat()
        if (not stat.S_ISREG(lock.st_mode) or lock.st_uid != 0 or lock.st_nlink != 1
                or stat.S_IMODE(lock.st_mode) != 0o600):
            raise ProvisionRejected("builder lock inode is unsafe")


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="install the fixed mount and provision isolated roots (requires --device-uuid)")
    parser.add_argument("--device-uuid", help="UUID of the already formatted dedicated ext4 builder partition")
    parser.add_argument("--check", action="store_true", help="check roots and one SHA-specific seed entry")
    parser.add_argument("--source-sha", help="exact 40-character release SHA to check; builder verifies contents")
    args = parser.parse_args(argv)
    try:
        if args.apply:
            if args.device_uuid is None:
                raise ProvisionRejected("--apply requires --device-uuid; no device is inferred")
            apply(device_uuid=args.device_uuid)
            print("Builder mount, identity, result root, and seed root provisioned; no seed generated or unit activated.")
        elif args.check:
            if args.source_sha is None:
                raise ProvisionRejected("--check requires --source-sha; no release SHA can be inferred")
            validate_prerequisites(args.source_sha)
            print("Builder roots and requested SHA seed entry are present; builder verification is still required.")
        else:
            for line in plan(args.device_uuid):
                print(line)
            print("Use --check --source-sha for per-SHA seed presence; the builder revalidates exact source contents.")
            if MAX_BUILD_FILESYSTEM_BYTES <= OBSERVED_GRAPH_FLOOR_BYTES:
                print("Current builder capacity cap is below the observed graph footprint; provisioning is blocked.")
        return 0
    except Exception as error:
        print(f"dependency-builder provisioning refused: {type(error).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
