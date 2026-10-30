#!/usr/bin/env python3
"""Install the narrow, read-only production release lock status service.

Dry-run is the default. `--apply` requires root, validates the three distinct
host identities, creates only baci-release's private lock-state directory
chain, installs the reviewed status helper and system unit, then enables and
starts the endpoint. It does not read or print lock contents or change any
runner, worker, credential, service, or production release state.
"""

from __future__ import annotations

import argparse
import grp
import hashlib
import os
import pwd
import shlex
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


RELEASE_USER = "baci-release"
DEPLOY_USERS = ("bassey", "baci-worker")
RELEASE_HOME = Path("/home/baci-release")
LOCK_DIR = RELEASE_HOME / ".local/state/baci"
LOCK_FILE = LOCK_DIR / "pending-production-release.json"
HELPER_DIR = Path("/usr/local/lib/baci-worker-broker")
HELPER_PATH = HELPER_DIR / "production_release_lock_status.py"
HELPER_CORE_PATH = HELPER_DIR / "production_release_lock_status_fs.py"
UNIT_NAME = "baci-production-release-lock-status.service"
UNIT_PATH = Path("/etc/systemd/system") / UNIT_NAME
SOURCE_ROOT = Path(__file__).resolve().parents[2]
REVIEWED_HELPER_SHA256 = "084e41dca1c83b53404913850f5e18c8c65fd4aaf67cb4cc71e5e53cf4013e77"
REVIEWED_HELPER_CORE_SHA256 = "ace5feb60e2df7bfe964215726d5327d5ae4b4510cb9f7e1005b22bac4cdb3c9"
REVIEWED_UNIT_SHA256 = "cf5cbc2a76f2502e90c36e0904917891d15b61f872e14be0e19453154f3ca496"


@dataclass(frozen=True)
class Paths:
    home: Path = RELEASE_HOME
    lock_dir: Path = LOCK_DIR
    lock_file: Path = LOCK_FILE
    helper_dir: Path = HELPER_DIR
    helper_path: Path = HELPER_PATH
    helper_core_path: Path = HELPER_CORE_PATH
    unit_dir: Path = UNIT_PATH.parent
    unit_path: Path = UNIT_PATH
    source_root: Path = SOURCE_ROOT


def _source(paths: Paths, relative: str, digest: str) -> bytes:
    path = paths.source_root / relative
    if not path.is_file() or path.is_symlink():
        raise RuntimeError(f"reviewed source is missing or not regular: {relative}")
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError(f"reviewed source hash mismatch: {relative}")
    return data


def _sources(paths: Paths) -> tuple[tuple[Path, bytes, int], ...]:
    helper = _source(paths, "vps-workers/bin/production_release_lock_status.py", REVIEWED_HELPER_SHA256)
    helper_core = _source(paths, "vps-workers/bin/production_release_lock_status_fs.py", REVIEWED_HELPER_CORE_SHA256)
    unit = _source(paths, "vps-workers/systemd/baci-production-release-lock-status.service", REVIEWED_UNIT_SHA256)
    unit_text = unit.decode("utf-8")
    requirements = (
        "User=root", "ProtectHome=tmpfs",
        "BindReadOnlyPaths=/home/baci-release/.local/state/baci:/run/baci-worker-release-status/lock-state",
        "RuntimeDirectory=baci-worker-release-status", "RuntimeDirectoryMode=0711",
        "ExecStart=/usr/bin/python3 /usr/local/lib/baci-worker-broker/production_release_lock_status.py serve",
        "RestrictAddressFamilies=AF_UNIX",
    )
    if any(value not in unit_text for value in requirements) or "ProtectHome=read-only" in unit_text:
        raise RuntimeError("reviewed lock status unit violates the exact-read-only-home policy")
    return ((paths.helper_path, helper, 0o550), (paths.helper_core_path, helper_core, 0o550),
            (paths.unit_path, unit, 0o644))


def plan(paths: Paths = Paths()) -> tuple[tuple[str, ...], ...]:
    return (
        ("install-private-home-chain", str(paths.home), str(paths.lock_dir)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(paths.helper_dir)),
        ("install", "-o", "root", "-g", "root", "-m", "0550", str(paths.helper_path)),
        ("install", "-o", "root", "-g", "root", "-m", "0550", str(paths.helper_core_path)),
        ("install", "-o", "root", "-g", "root", "-m", "0644", str(paths.unit_path)),
        ("systemctl", "daemon-reload"),
        ("systemctl", "enable", "--now", UNIT_NAME),
        ("systemctl", "is-active", "--quiet", UNIT_NAME),
    )


def _validate_accounts() -> tuple[int, int]:
    release = pwd.getpwnam(RELEASE_USER)
    release_group = grp.getgrnam(RELEASE_USER)
    if release.pw_uid <= 0 or release.pw_gid != release_group.gr_gid or release.pw_dir != str(RELEASE_HOME):
        raise RuntimeError("baci-release identity does not match the lock owner contract")
    if release.pw_shell != "/usr/sbin/nologin" or release_group.gr_mem:
        raise RuntimeError("baci-release shell or primary group does not match the isolated identity contract")
    groups = {grp.getgrgid(gid).gr_name for gid in os.getgrouplist(RELEASE_USER, release.pw_gid)}
    if groups != {RELEASE_USER} or groups.intersection({"sudo", "docker"}):
        raise RuntimeError("baci-release has unapproved supplementary groups")
    if any(entry.pw_uid == release.pw_uid and entry.pw_name != RELEASE_USER for entry in pwd.getpwall()):
        raise RuntimeError("baci-release UID is shared by another passwd entry")
    ids = {release.pw_uid}
    for name in DEPLOY_USERS:
        uid = pwd.getpwnam(name).pw_uid
        if uid <= 0 or uid in ids:
            raise RuntimeError("deploy and release account identities must be distinct")
        ids.add(uid)
    return release.pw_uid, release.pw_gid


def _validate_directory(path: Path, *, uid: int, gid: int, mode: int) -> bool:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or
            (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (uid, gid, mode)):
        raise RuntimeError(f"lock status directory ownership or mode is unsafe: {path}")
    return True


def _prepare_home_chain(paths: Paths, *, uid: int, gid: int, root_uid: int = 0,
                        chown: Callable[[str, int, int], None] = os.chown,
                        mkdir: Callable[..., None] = os.mkdir,
                        chmod: Callable[[str, int], None] = os.chmod) -> None:
    home_parent = paths.home.parent
    parent_info = home_parent.lstat()
    if (not stat.S_ISDIR(parent_info.st_mode) or stat.S_ISLNK(parent_info.st_mode) or
            parent_info.st_uid != root_uid or stat.S_IMODE(parent_info.st_mode) & 0o022):
        raise RuntimeError("/home is not root-owned and protected")

    for path in (paths.home, paths.home / ".local", paths.home / ".local/state", paths.lock_dir):
        exists = _validate_directory(path, uid=uid, gid=gid, mode=0o700)
        if exists:
            continue
        mkdir(str(path), 0o700)
        chown(str(path), uid, gid)
        chmod(str(path), 0o700)

    try:
        info = paths.lock_file.lstat()
    except FileNotFoundError:
        return
    if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != uid or
            stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
        raise RuntimeError("existing production release lock metadata is unsafe")


def _check_parent_chain(path: Path, *, root_uid: int) -> None:
    current = path.parent
    while current != current.parent:
        info = current.lstat()
        if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or
                info.st_uid != root_uid or stat.S_IMODE(info.st_mode) & 0o022):
            raise RuntimeError(f"protected install directory is unsafe: {current}")
        current = current.parent


def _install_file(target: Path, data: bytes, mode: int, *, root_uid: int = 0, root_gid: int = 0) -> bool:
    target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    _check_parent_chain(target, root_uid=root_uid)
    try:
        info = target.lstat()
    except FileNotFoundError:
        info = None
    if info is not None:
        if (not stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != root_uid or
                info.st_gid != root_gid or stat.S_IMODE(info.st_mode) != mode or target.read_bytes() != data):
            raise RuntimeError(f"existing protected file differs; refusing overwrite: {target}")
        return False

    fd, temporary = tempfile.mkstemp(prefix=".baci-lock-status-", dir=target.parent)
    published = False
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, root_uid, root_gid)
        os.chmod(temporary, mode)
        os.link(temporary, target, follow_symlinks=False)
        published = True
        os.unlink(temporary)
        directory_fd = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        if published:
            try:
                if target.is_file() and not target.is_symlink() and target.read_bytes() == data:
                    target.unlink()
            except OSError:
                pass
        raise
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return True


def apply(paths: Paths = Paths(), *, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run,
          root_uid: int = 0, root_gid: int = 0) -> None:
    if os.geteuid() != root_uid:
        raise RuntimeError("--apply requires root")
    release_uid, release_gid = _validate_accounts()
    files = _sources(paths)
    _prepare_home_chain(paths, uid=release_uid, gid=release_gid, root_uid=root_uid)
    installed: list[tuple[Path, bytes]] = []
    for target, data, mode in files:
        if _install_file(target, data, mode, root_uid=root_uid, root_gid=root_gid):
            installed.append((target, data))
    try:
        for command in (("systemctl", "daemon-reload"), ("systemctl", "enable", "--now", UNIT_NAME),
                        ("systemctl", "is-active", "--quiet", UNIT_NAME)):
            runner(command, check=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    except Exception as error:
        stop_result = runner(("systemctl", "disable", "--now", UNIT_NAME), check=False,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        if stop_result.returncode != 0:
            raise RuntimeError("lock status service state is ambiguous; retained installed files for recovery") from error
        for target, data in reversed(installed):
            try:
                if target.is_file() and not target.is_symlink() and target.read_bytes() == data:
                    target.unlink()
            except OSError:
                pass
        runner(("systemctl", "daemon-reload"), check=False, stdin=subprocess.DEVNULL,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raise


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="install and start the root lock status service")
    args = parser.parse_args(argv)
    try:
        files = _sources(Paths())
        if not args.apply:
            for command in plan():
                print(shlex.join(command))
            for target, data, mode in files:
                print(f"install root:root {mode:04o} {target} sha256={hashlib.sha256(data).hexdigest()}")
            print("Dry run only. Pass --apply after account and lock-directory preflight.")
            return 0
        apply()
        print("Read-only production release lock status service is installed and active.")
        print("Only the baci-release lock-state directory is visible read-only inside its home namespace.")
        return 0
    except (OSError, RuntimeError, KeyError, subprocess.CalledProcessError) as error:
        print(f"release lock status provisioning failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
