#!/usr/bin/env python3
"""Dry-run-first installer for the disconnected source extractor unit."""
from __future__ import annotations

import argparse
import grp
import os
import pwd
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from provision_worker_release_install import install_one

USER = GROUP = "baci-release-extractor"
NOLOGIN = "/usr/sbin/nologin"
HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
UNIT = Path("/etc/systemd/system/baci-worker-source-extract@.service")
TMPFILES = Path("/etc/tmpfiles.d/baci-worker-source-extract.conf")
RUNTIME_ROOT = Path("/run/baci-worker-release-extract")
RESOURCE_ROOT = RUNTIME_ROOT / "resources"
CONTROL_ROOT = RUNTIME_ROOT / "control"
REPO = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class File:
    relative: str
    content: bytes
    mode: int
    destination: Path
    group: str = "root"


def _source(relative: str) -> bytes:
    path = REPO / relative
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"trusted extractor source is unavailable: {relative}")
    return path.read_bytes()


def install_files() -> tuple[File, ...]:
    return (
        File("archive-child", _source("vps-workers/bin/worker_release_archive_extract_child.py"),
             0o550, HELPER_ROOT / "worker_release_archive_extract_child.py"),
        File("archive-reader", _source("vps-workers/bin/worker_release_archive.py"),
             0o440, HELPER_ROOT / "worker_release_archive.py"),
        File("broker-common", _source("vps-workers/bin/worker_release_broker_common.py"),
             0o440, HELPER_ROOT / "worker_release_broker_common.py"),
        File("systemd-contract", _source("vps-workers/bin/worker_release_systemd_contract.py"),
             0o440, HELPER_ROOT / "worker_release_systemd_contract.py"),
        File("extract-unit", _source("vps-workers/systemd/baci-worker-source-extract@.service"),
             0o644, UNIT),
        File("extract-tmpfiles", _source("vps-workers/systemd/baci-worker-source-extract.tmpfiles"),
             0o644, TMPFILES),
    )


def _identity() -> tuple[int, int]:
    group, user = grp.getgrnam(GROUP), pwd.getpwnam(USER)
    if (user.pw_gid != group.gr_gid or user.pw_shell != NOLOGIN
            or user.pw_dir != "/nonexistent" or group.gr_mem):
        raise RuntimeError("extractor account does not match the fixed identity contract")
    if any(entry.pw_uid == user.pw_uid and entry.pw_name != USER for entry in pwd.getpwall()):
        raise RuntimeError("extractor UID is shared")
    if os.getgrouplist(USER, user.pw_gid) != [group.gr_gid]:
        raise RuntimeError("extractor has unexpected supplementary groups")
    return user.pw_uid, group.gr_gid


def _runtime_paths(uid: int, gid: int) -> None:
    def ensure(path: Path, owner: int, group: int, mode: int) -> None:
        try:
            info = path.lstat()
        except FileNotFoundError:
            os.mkdir(path, mode)
            os.chown(path, owner, group)
            os.chmod(path, mode)
            parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            info = path.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
                or (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (owner, group, mode)):
            raise RuntimeError("extractor runtime path ownership or mode is unsafe")

    ensure(RUNTIME_ROOT, 0, 0, 0o711)
    ensure(RESOURCE_ROOT, uid, gid, 0o700)
    ensure(CONTROL_ROOT, 0, gid, 0o710)
    if os.listdir(RESOURCE_ROOT) or os.listdir(CONTROL_ROOT):
        raise RuntimeError("extractor runtime paths contain unclaimed state; refusing adoption")


def apply(*, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("--apply requires root")
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
        raise RuntimeError("partial extractor account exists; refusing to repair it")
    if not group_exists:
        runner(("groupadd", "--system", GROUP), check=True, stdin=subprocess.DEVNULL)
        runner(("useradd", "--system", "--gid", GROUP, "--home-dir", "/nonexistent",
                "--no-create-home", "--shell", NOLOGIN, USER), check=True, stdin=subprocess.DEVNULL)
    uid, gid = _identity()
    _runtime_paths(uid, gid)
    for item in install_files():
        from provision_worker_release_install import InstallFile
        install_one(InstallFile(item.relative, item.content, item.mode, item.destination, item.group))
    runner(("systemd-tmpfiles", "--create", str(TMPFILES)), check=True, stdin=subprocess.DEVNULL)
    runner(("systemctl", "daemon-reload"), check=True, stdin=subprocess.DEVNULL)


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="install the isolated extractor prototype")
    args = parser.parse_args(argv)
    try:
        if args.apply:
            apply()
            print("Source extractor unit installed; it was not enabled or started.")
        else:
            for item in install_files():
                print(f"would install {item.destination} mode {item.mode:o} group {item.group}")
            print("would create a dedicated no-login extractor identity and private runtime paths")
        return 0
    except Exception as error:
        print(f"source extractor provisioning refused: {type(error).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
