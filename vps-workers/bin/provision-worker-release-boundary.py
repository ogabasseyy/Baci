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
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

from worker_release_broker_module_closure import BROKER_RUNTIME_MODULES


RELEASE = "baci-release"
WORKER = "baci-worker"
NOLOGIN = "/usr/sbin/nologin"
HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
UNIT_PATH = Path("/etc/systemd/system/baci-worker-release-broker.service")
HOME = Path("/home/baci-release")
REPO_ROOT = Path(__file__).resolve().parents[2]

UNIT = """[Unit]
Description=Baci worker release broker
After=network-online.target
Wants=network-online.target
Wants=baci-domain-event-router.service baci-event-delivery-worker.service baci-quiz-finalization.service
Wants=baci-cache-invalidation-drain.timer baci-gigl-tracking.timer

[Service]
Type=simple
User=root
Group=root
RuntimeDirectory=baci-worker-release
RuntimeDirectoryGroup=baci-release
RuntimeDirectoryMode=0710
RuntimeDirectoryPreserve=no
ExecStart=/usr/local/lib/baci-worker-broker/start-broker.sh
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/srv/baci-workers /run/baci-worker-release /run/baci-worker-release-gate
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
LockPersonality=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
"""

START_BROKER = """#!/usr/bin/env bash
set -euo pipefail
readonly release_uid="$(/usr/bin/id -u baci-release)"
readonly worker_uid="$(/usr/bin/id -u baci-worker)"
readonly worker_gid="$(/usr/bin/id -g baci-worker)"
readonly gate_dir=/run/baci-worker-release-gate
/usr/bin/install -d -o root -g baci-worker -m 0710 "$gate_dir"
gate_socket="$gate_dir/health.sock"
if [ -e "$gate_socket" ] || [ -L "$gate_socket" ]; then
  [ -S "$gate_socket" ] && [ ! -L "$gate_socket" ] || exit 1
  [ "$(/usr/bin/stat -c '%u:%g:%a' "$gate_socket")" = "0:$worker_gid:660" ] || exit 1
  /usr/bin/rm -- "$gate_socket"
fi
exec /usr/bin/python3 /usr/local/lib/baci-worker-broker/worker_release_broker.py \\
  --release-uid "$release_uid" --worker-uid "$worker_uid" --worker-gid "$worker_gid"
"""

DISPATCHER_WRAPPER = """#!/usr/bin/node
import './bin/worker-release-broker-dispatch.mjs';
"""


@dataclass(frozen=True)
class InstallFile:
    relative: str
    content: bytes
    mode: int
    destination: Path
    group: str = "root"


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


def install_files() -> tuple[InstallFile, ...]:
    files = [
        InstallFile("broker.py", _source("vps-workers/bin/worker_release_broker.py"), 0o550, HELPER_ROOT / "worker_release_broker.py"),
        InstallFile("broker-common.py", _source("vps-workers/bin/worker_release_broker_common.py"), 0o440, HELPER_ROOT / "worker_release_broker_common.py"),
        InstallFile("broker-archive.py", _source("vps-workers/bin/worker_release_archive.py"), 0o440, HELPER_ROOT / "worker_release_archive.py"),
        InstallFile("broker-dispatch.py", _source("vps-workers/bin/worker_release_broker_dispatch.py"), 0o440, HELPER_ROOT / "worker_release_broker_dispatch.py"),
        InstallFile("broker-staging.py", _source("vps-workers/bin/worker_release_staging.py"), 0o440, HELPER_ROOT / "worker_release_staging.py"),
        InstallFile("broker-state.py", _source("vps-workers/bin/worker_release_state.py"), 0o440, HELPER_ROOT / "worker_release_state.py"),
        InstallFile("recovery-dispatch.py", _source("vps-workers/bin/worker_release_recovery_dispatch.py"), 0o440, HELPER_ROOT / "worker_release_recovery_dispatch.py"),
        InstallFile("recovery-lifecycle.py", _source("vps-workers/bin/worker_release_recovery_lifecycle.py"), 0o440, HELPER_ROOT / "worker_release_recovery_lifecycle.py"),
        InstallFile("broker-gigl.py", _source("vps-workers/bin/worker_release_gigl.py"), 0o440, HELPER_ROOT / "worker_release_gigl.py"),
        InstallFile("readiness.py", _source("vps-workers/bin/worker_release_readiness.py"), 0o440, HELPER_ROOT / "worker_release_readiness.py"),
        InstallFile("lifecycle.py", _source("vps-workers/bin/worker_release_lifecycle.py"), 0o440, HELPER_ROOT / "worker_release_lifecycle.py"),
        InstallFile("lease.py", _source("vps-workers/bin/worker_release_quiesce_lease.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_lease.py"),
        InstallFile("lease-identity.py", _source("vps-workers/bin/worker_release_quiesce_lease_identity.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_lease_identity.py"),
        InstallFile("lease-locks.py", _source("vps-workers/bin/worker_release_quiesce_locks.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_locks.py"),
        InstallFile("lease-runtime.py", _source("vps-workers/bin/worker_release_quiesce_lease_runtime.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_lease_runtime.py"),
        InstallFile("lease-core.py", _source("vps-workers/bin/worker_release_quiesce_lease_core.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_lease_core.py"),
        InstallFile("lease-manager.py", _source("vps-workers/bin/worker_release_quiesce_lease_manager.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_lease_manager.py"),
        InstallFile("lease-recovery-latch.py", _source("vps-workers/bin/worker_release_recovery_latch.py"), 0o440, HELPER_ROOT / "worker_release_recovery_latch.py", "baci-locks"),
        InstallFile("lease-gate.py", _source("vps-workers/bin/worker_release_quiesce_gate.py"), 0o440, HELPER_ROOT / "worker_release_quiesce_gate.py"),
        InstallFile("launch-gate", _source("vps-workers/bin/worker-release-launch-gate"), 0o550, HELPER_ROOT / "worker-release-launch-gate", "baci-locks"),
        InstallFile("dispatcher.mjs", _source("vps-workers/bin/worker-release-broker-dispatch.mjs"), 0o440, HELPER_ROOT / "bin/worker-release-broker-dispatch.mjs"),
        InstallFile("broker-policy.mjs", _source("vps-workers/lib/worker-release-broker.mjs"), 0o440, HELPER_ROOT / "lib/worker-release-broker.mjs"),
        InstallFile("github-proof.mjs", _source("vps-workers/lib/worker-release-github-proof.mjs"), 0o440, HELPER_ROOT / "lib/worker-release-github-proof.mjs"),
        InstallFile("quiesce.sh", _source("vps-workers/lib/worker-release-quiesce-lease.sh"), 0o550, HELPER_ROOT / "worker-release-quiesce-lease.sh"),
        InstallFile("health-check", _source("vps-workers/bin/worker-release-health-check"), 0o550, HELPER_ROOT / "worker-release-health-check"),
        InstallFile("broker-start", START_BROKER.encode(), 0o550, HELPER_ROOT / "start-broker.sh"),
        InstallFile("dispatcher-wrapper", DISPATCHER_WRAPPER.encode(), 0o550, HELPER_ROOT / "worker-release-broker-dispatch.mjs"),
        InstallFile("systemd-unit", UNIT.encode(), 0o644, UNIT_PATH),
    ]
    installed_names = {file.destination.name for file in files
                       if file.destination.parent == HELPER_ROOT}
    for module in BROKER_RUNTIME_MODULES:
        filename = f"{module}.py"
        if filename not in installed_names:
            source_relative = (
                f"vps-workers/tools/nonproduction-worker-release/{filename}"
                if module.startswith("dependency_seed_")
                else f"vps-workers/bin/{filename}"
            )
            files.append(InstallFile(f"broker-runtime-{module}",
                                     _source(source_relative),
                                     0o440, HELPER_ROOT / filename))
    return tuple(files)


def provisioning_plan() -> tuple[tuple[str, ...], ...]:
    return (
        ("groupadd", "--system", RELEASE),
        ("useradd", "--system", "--gid", RELEASE, "--home-dir", str(HOME), "--no-create-home", "--shell", NOLOGIN, RELEASE),
        ("install", "-d", "-o", RELEASE, "-g", RELEASE, "-m", "0700", str(HOME)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(HELPER_ROOT)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(HELPER_ROOT / "bin")),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(HELPER_ROOT / "lib")),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0711", str(RUNTIME_VIEW_ROOT)),
        ("systemctl", "daemon-reload"),
        ("systemctl", "enable", "--now", "baci-worker-release-broker.service"),
    )


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


from provision_worker_release_install import (ensure_runtime_view_root, read_existing as _read_existing,
                                              read_trusted_source, install_one as _install_one,
                                              RUNTIME_VIEW_ROOT)


def apply(*, runner: Callable[..., subprocess.CompletedProcess] = subprocess.run) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("--apply requires root")
    _validate_account(WORKER, expected_shell=NOLOGIN, expected_home="/srv/baci-workers/home")
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
    ensure_runtime_view_root()
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
    for file in install_files():
        _install_one(file)
    runner(("systemctl", "daemon-reload"), check=True, stdin=subprocess.DEVNULL)
    runner(("systemctl", "enable", "--now", "baci-worker-release-broker.service"), check=True, stdin=subprocess.DEVNULL)
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
