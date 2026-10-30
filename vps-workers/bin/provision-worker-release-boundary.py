#!/usr/bin/env python3
"""Provision the dedicated release identity and protected root broker.

Dry-run is the default. `--apply` requires root, creates only the baci-release
system identity and its private home, installs an immutable root-owned broker
helper set, then reloads and enables the broker service. The worker identity
and /srv/baci-workers layout must already exist through provision-baci-worker.py.
This script does not install the GitHub runner, create credentials, alter cron,
or stop/migrate any existing worker.
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
from pathlib import Path
from typing import Callable, Sequence

from worker_release_broker_module_closure import BROKER_RUNTIME_MODULES
from worker_release_egress_identity import EGRESS_GROUP, EGRESS_USER, egress_identity
from worker_release_egress_identity_provision import ensure_egress_identity
from worker_release_broker_generation import current_generation, publish_generation
from worker_release_broker_generation_install import split_install_records
import worker_release_broker_install_preflight as install_preflight
from worker_release_broker_upgrade import (
    SystemdBrokerControl, bootstrap_generation, recover_interrupted_upgrade,
    upgrade_generation,
)
from provision_worker_release_install import (ensure_runtime_view_root, read_existing as _read_existing,
                                              read_trusted_source, install_one as _install_one,
                                              RUNTIME_VIEW_ROOT, ensure_root_directory)


RELEASE = "baci-release"
WORKER = "baci-worker"
NOLOGIN = "/usr/sbin/nologin"
HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
UNIT_PATH = Path("/etc/systemd/system/baci-worker-release-broker.service")
HOME = Path("/home/baci-release")
BUILD_ROOT = Path("/run/baci-worker-release-build")
BUILD_RESULTS_ROOT = BUILD_ROOT / "results"
BUILD_USER = "baci-release-build"
BUILD_GROUP = "baci-release-build"
BROKER_STATE_ROOT = Path("/var/lib/baci-worker-broker")
BROKER_POINTER_ROOT = BROKER_STATE_ROOT / "pointer"
BROKER_TRANSACTION_ROOT = BROKER_STATE_ROOT / "transaction"
BUILD_NOLOGIN = "/usr/sbin/nologin"
REPO_ROOT = Path(__file__).resolve().parents[2]

from worker_release_broker_install_manifest import (
    DISPATCHER_WRAPPER, InstallFile, START_BROKER, UNIT, build_install_files,
    build_provisioning_plan,
)

def _source(relative: str) -> bytes:
    source_uid = os.getuid()
    if os.geteuid() == 0 and "SUDO_UID" in os.environ:
        value = os.environ["SUDO_UID"]
        if not value.isdecimal():
            raise RuntimeError("trusted source checkout owner identity is malformed")
        source_uid = int(value)
    try:
        return read_trusted_source(REPO_ROOT, relative, source_uid=source_uid)
    except (OSError, RuntimeError, ValueError) as error:
        raise RuntimeError(f"required trusted source could not be read safely: {relative}") from error


preflight_install_files = lambda files: install_preflight.preflight_install_files(
    files, read_existing=_read_existing)


def install_files() -> tuple[InstallFile, ...]:
    return build_install_files(_source, HELPER_ROOT, UNIT_PATH, BROKER_RUNTIME_MODULES)


def provisioning_plan() -> tuple[tuple[str, ...], ...]:
    return build_provisioning_plan(release=RELEASE, home=HOME, helper_root=HELPER_ROOT,
                                   runtime_view_root=RUNTIME_VIEW_ROOT,
                                   state_root=BROKER_STATE_ROOT,
                                   pointer_root=BROKER_POINTER_ROOT,
                                   transaction_root=BROKER_TRANSACTION_ROOT)


def _validate_account(name: str, *, expected_shell: str, expected_home: str) -> None:
    group = grp.getgrnam(name)
    user = pwd.getpwnam(name)
    if user.pw_gid != group.gr_gid or user.pw_shell != expected_shell or user.pw_dir != expected_home:
        raise RuntimeError(f"existing {name} account does not match the isolated identity contract")
    if group.gr_mem:
        raise RuntimeError(f"existing {name} group has unexpected members")
    if any(entry.pw_uid == user.pw_uid and entry.pw_name != name for entry in pwd.getpwall()):
        raise RuntimeError(f"{name} UID is shared by another passwd entry")
    supplementary = {grp.getgrgid(gid).gr_name for gid in os.getgrouplist(name, user.pw_gid)}
    expected_supplementary = {name, "baci-locks"} if name == WORKER else {name}
    if supplementary != expected_supplementary:
        raise RuntimeError(f"{name} has unexpected supplementary groups")
    if supplementary.intersection({"sudo", "docker"}):
        raise RuntimeError(f"{name} cannot belong to sudo or docker")


def _check_identities() -> None:
    _validate_account(RELEASE, expected_shell=NOLOGIN, expected_home=str(HOME))
    _validate_account(WORKER, expected_shell=NOLOGIN, expected_home="/srv/baci-workers/home")
    if grp.getgrnam(RELEASE).gr_gid == grp.getgrnam(WORKER).gr_gid:
        raise RuntimeError("release and worker groups must be distinct")
    lock_group = grp.getgrnam("baci-locks")
    _validate_bassey_lock_group(lock_group.gr_gid)
    if set(lock_group.gr_mem) - {"bassey", WORKER}:
        raise RuntimeError("baci-locks has unexpected members")
    if WORKER not in lock_group.gr_mem:
        raise RuntimeError("baci-worker is missing the protected lock group")
    egress_identity()


def _validate_dependency_builder_prerequisites(*, build_root: Path = BUILD_ROOT,
                                               results_root: Path = BUILD_RESULTS_ROOT) -> None:
    """Require the separately provisioned bounded builder mount before broker start.

    The broker's strict systemd namespace permits writes only to fixed build
    scratch and runtime-view roots. This check does not create or resize either
    root; the dedicated builder provisioner owns that setup.
    """
    try:
        group = grp.getgrnam(BUILD_GROUP)
        user = pwd.getpwnam(BUILD_USER)
        worker = pwd.getpwnam(WORKER)
        try:
            release = pwd.getpwnam(RELEASE)
            release_gid = grp.getgrnam(RELEASE).gr_gid
        except KeyError:
            release = None
            release_gid = None
        supplementary = os.getgrouplist(BUILD_USER, user.pw_gid)
        passwd_entries = pwd.getpwall()
        group_entries = grp.getgrall()
    except (KeyError, OSError) as error:
        raise RuntimeError("dedicated dependency builder identity is not provisioned") from error
    if (user.pw_uid <= 0 or user.pw_uid == worker.pw_uid
            or (release is not None and user.pw_uid == release.pw_uid)
            or user.pw_gid != group.gr_gid or user.pw_shell != BUILD_NOLOGIN
            or user.pw_dir != "/nonexistent" or group.gr_mem
            or supplementary != [group.gr_gid]
            or group.gr_gid == worker.pw_gid or (release_gid is not None and group.gr_gid == release_gid)
            or any(item.pw_uid == user.pw_uid and item.pw_name != BUILD_USER
                   for item in passwd_entries)
            or any(item.pw_gid == group.gr_gid and item.pw_name != BUILD_USER
                   for item in passwd_entries)
            or any(item.gr_gid == group.gr_gid and item.gr_name != BUILD_GROUP
                   for item in group_entries)):
        raise RuntimeError("dependency builder identity is not isolated")
    try:
        build_info = build_root.lstat()
        results_info = results_root.lstat()
    except OSError as error:
        raise RuntimeError("fixed dependency builder filesystem is not provisioned") from error
    if (not stat.S_ISDIR(build_info.st_mode) or stat.S_ISLNK(build_info.st_mode)
            or build_info.st_uid != 0 or build_info.st_gid != group.gr_gid
            or stat.S_IMODE(build_info.st_mode) != 0o710
            or not os.path.ismount(build_root)):
        raise RuntimeError("dependency builder filesystem is not the fixed mount")
    if (not stat.S_ISDIR(results_info.st_mode) or stat.S_ISLNK(results_info.st_mode)
            or results_info.st_uid != 0 or results_info.st_gid != group.gr_gid
            or stat.S_IMODE(results_info.st_mode) != 0o700):
        raise RuntimeError("dependency builder result root ownership or mode is unsafe")


def _validate_bassey_lock_group(lock_gid: int) -> None:
    bassey = pwd.getpwnam("bassey")
    if lock_gid not in os.getgrouplist("bassey", bassey.pw_gid):
        raise RuntimeError("bassey is missing the protected lock group required by the scheduled launch gate")


def _existing_identity_state() -> tuple[bool, bool]:
    try:
        grp.getgrnam(RELEASE)
        group_exists = True
    except KeyError:
        group_exists = False
    try:
        pwd.getpwnam(RELEASE)
        user_exists = True
    except KeyError:
        user_exists = False
    if group_exists != user_exists:
        raise RuntimeError("partial baci-release identity exists; refusing to repair it")
    if user_exists:
        _validate_account(RELEASE, expected_shell=NOLOGIN, expected_home=str(HOME))
    return group_exists, user_exists


def _check_release_home(*, account_exists: bool) -> bool:
    try:
        metadata = HOME.lstat()
    except FileNotFoundError:
        return False
    if not account_exists:
        raise RuntimeError("release home exists without its matching identity; refusing to adopt its contents")
    release_uid = pwd.getpwnam(RELEASE).pw_uid
    release_gid = grp.getgrnam(RELEASE).gr_gid
    if (not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode) or
            (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (release_uid, release_gid, 0o700)):
        raise RuntimeError("existing release home ownership or mode is not trusted")
    return True


def apply(*, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("--apply requires root")
    _validate_account(WORKER, expected_shell=NOLOGIN, expected_home="/srv/baci-workers/home")
    _validate_dependency_builder_prerequisites()
    ensure_egress_identity(runner=runner)
    release_group_exists, release_user_exists = _existing_identity_state()
    release_home_exists = _check_release_home(account_exists=release_user_exists)
    if not release_group_exists:
        runner(("groupadd", "--system", RELEASE), check=True, stdin=subprocess.DEVNULL)
    if not release_user_exists:
        runner(("useradd", "--system", "--gid", RELEASE, "--home-dir", str(HOME),
                "--no-create-home", "--shell", NOLOGIN, RELEASE), check=True,
               stdin=subprocess.DEVNULL)
    if not release_home_exists:
        runner(("install", "-d", "-o", RELEASE, "-g", RELEASE, "-m", "0700", str(HOME)),
               check=True, stdin=subprocess.DEVNULL)
    _check_identities()
    _validate_dependency_builder_prerequisites()
    ensure_runtime_view_root()
    ensure_root_directory(HELPER_ROOT, uid=0, gid=0, mode=0o755)
    ensure_root_directory(BROKER_STATE_ROOT, uid=0, gid=0, mode=0o755)
    ensure_root_directory(BROKER_POINTER_ROOT, uid=0, gid=0, mode=0o711)
    ensure_root_directory(BROKER_TRANSACTION_ROOT, uid=0, gid=0, mode=0o700)
    control = SystemdBrokerControl()
    recover_interrupted_upgrade(
        HELPER_ROOT, control=control,
        state_root=BROKER_POINTER_ROOT, state_mode=0o711,
        transaction_root=BROKER_TRANSACTION_ROOT,
    )
    # Require the dedicated worker tree and refuse symlinks or permissions that
    # would let the release identity replace broker-owned paths.
    for path, owner, group, mode in (
        (Path("/srv/baci-workers"), "root", "baci-locks", 0o710),
        (Path("/srv/baci-workers/releases"), "root", WORKER, 0o750),
    ):
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise RuntimeError(f"worker release path is not a real directory: {path}")
        if (pwd.getpwuid(info.st_uid).pw_name, grp.getgrgid(info.st_gid).gr_name, stat.S_IMODE(info.st_mode)) != (owner, group, mode):
            raise RuntimeError(f"worker release path ownership or mode is not trusted: {path}")
    files = install_files()
    stable_files, generation_files = split_install_records(
        files, HELPER_ROOT, lambda group: grp.getgrnam(group).gr_gid)
    old_digest = current_generation(HELPER_ROOT, state_root=BROKER_POINTER_ROOT,
                                   state_mode=0o711)
    install_preflight.install_stable_files(
        stable_files, current_digest=old_digest, control=control,
        read_existing=_read_existing, writer=_install_one)
    runner(("systemctl", "daemon-reload"), check=True, stdin=subprocess.DEVNULL)
    runner(("systemd-tmpfiles", "--create", "/etc/tmpfiles.d/baci-worker-egress.conf"),
           check=True, stdin=subprocess.DEVNULL)
    new_digest = publish_generation(HELPER_ROOT, generation_files)
    if old_digest is None:
        bootstrap_generation(HELPER_ROOT, new_digest, control=control,
                             state_root=BROKER_POINTER_ROOT, state_mode=0o711,
                             transaction_root=BROKER_TRANSACTION_ROOT)
    elif old_digest != new_digest:
        upgrade_generation(HELPER_ROOT, new_digest, control=control,
                           state_root=BROKER_POINTER_ROOT, state_mode=0o711,
                           transaction_root=BROKER_TRANSACTION_ROOT)
    runner(("systemctl", "enable", "baci-worker-release-broker.service"), check=True, stdin=subprocess.DEVNULL)
    runner(("systemctl", "start", "baci-worker-release-broker.service"), check=True, stdin=subprocess.DEVNULL)
    runner(("systemctl", "is-active", "--quiet", "baci-worker-release-broker.service"), check=True, stdin=subprocess.DEVNULL)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="apply root-owned identity and broker setup; default prints plan")
    args = parser.parse_args(argv)
    try:
        files = install_files()
        if not args.apply:
            for action in provisioning_plan():
                print(shlex.join(action))
            for file in files:
                digest = hashlib.sha256(file.content).hexdigest()
                print(f"install root:{file.group} {file.mode:04o} {file.destination} sha256={digest}")
            print("Dry run only. Requires baci-worker identity/root layout before --apply.")
            return 0
        apply()
        print("baci-release identity and root-owned worker release broker provisioned and active.")
        print("No runner, credential, cron, existing worker service, or checkout was changed.")
        return 0
    except (OSError, RuntimeError, KeyError, subprocess.CalledProcessError) as error:
        print(f"worker release boundary provisioning failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
