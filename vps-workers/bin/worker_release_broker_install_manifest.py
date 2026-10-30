"""Fixed service unit and immutable broker install manifest."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


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
TimeoutStopSec=1200s
KillMode=mixed
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths=/srv/baci-workers /run/baci-worker-release /run/baci-worker-release-gate /run/baci-worker-release-build /var/lib/baci-worker-runtime-views /var/lib/baci-worker-broker/pointer /var/lib/baci-worker-broker/transaction
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
exec /usr/bin/python3 -I /usr/local/lib/baci-worker-broker/worker_release_broker_launcher.py \\
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


def build_install_files(source: Callable[[str], bytes], helper_root: Path,
                        unit_path: Path, runtime_modules: Iterable[str]) -> tuple[InstallFile, ...]:
    files = [
        InstallFile("broker.py", source("vps-workers/bin/worker_release_broker.py"), 0o550, helper_root / "worker_release_broker.py"),
        InstallFile("broker-common.py", source("vps-workers/bin/worker_release_broker_common.py"), 0o440, helper_root / "worker_release_broker_common.py"),
        InstallFile("broker-archive.py", source("vps-workers/bin/worker_release_archive.py"), 0o440, helper_root / "worker_release_archive.py"),
        InstallFile("broker-dispatch.py", source("vps-workers/bin/worker_release_broker_dispatch.py"), 0o440, helper_root / "worker_release_broker_dispatch.py"),
        InstallFile("broker-staging.py", source("vps-workers/bin/worker_release_staging.py"), 0o440, helper_root / "worker_release_staging.py"),
        InstallFile("broker-state.py", source("vps-workers/bin/worker_release_state.py"), 0o440, helper_root / "worker_release_state.py"),
        InstallFile("recovery-dispatch.py", source("vps-workers/bin/worker_release_recovery_dispatch.py"), 0o440, helper_root / "worker_release_recovery_dispatch.py"),
        InstallFile("recovery-lifecycle.py", source("vps-workers/bin/worker_release_recovery_lifecycle.py"), 0o440, helper_root / "worker_release_recovery_lifecycle.py"),
        InstallFile("broker-gigl.py", source("vps-workers/bin/worker_release_gigl.py"), 0o440, helper_root / "worker_release_gigl.py"),
        InstallFile("readiness.py", source("vps-workers/bin/worker_release_readiness.py"), 0o440, helper_root / "worker_release_readiness.py"),
        InstallFile("lifecycle.py", source("vps-workers/bin/worker_release_lifecycle.py"), 0o440, helper_root / "worker_release_lifecycle.py"),
        InstallFile("lease.py", source("vps-workers/bin/worker_release_quiesce_lease.py"), 0o440, helper_root / "worker_release_quiesce_lease.py"),
        InstallFile("lease-identity.py", source("vps-workers/bin/worker_release_quiesce_lease_identity.py"), 0o440, helper_root / "worker_release_quiesce_lease_identity.py"),
        InstallFile("lease-locks.py", source("vps-workers/bin/worker_release_quiesce_locks.py"), 0o440, helper_root / "worker_release_quiesce_locks.py"),
        InstallFile("lease-runtime.py", source("vps-workers/bin/worker_release_quiesce_lease_runtime.py"), 0o440, helper_root / "worker_release_quiesce_lease_runtime.py"),
        InstallFile("lease-core.py", source("vps-workers/bin/worker_release_quiesce_lease_core.py"), 0o440, helper_root / "worker_release_quiesce_lease_core.py"),
        InstallFile("lease-manager.py", source("vps-workers/bin/worker_release_quiesce_lease_manager.py"), 0o440, helper_root / "worker_release_quiesce_lease_manager.py"),
        InstallFile("lease-recovery-latch.py", source("vps-workers/bin/worker_release_recovery_latch.py"), 0o440, helper_root / "worker_release_recovery_latch.py", "baci-locks"),
        InstallFile("lease-gate.py", source("vps-workers/bin/worker_release_quiesce_gate.py"), 0o440, helper_root / "worker_release_quiesce_gate.py"),
        InstallFile("launch-gate", source("vps-workers/bin/worker-release-launch-gate"), 0o550, helper_root / "worker-release-launch-gate", "baci-locks"),
        InstallFile("dispatcher.mjs", source("vps-workers/bin/worker-release-broker-dispatch.mjs"), 0o440, helper_root / "bin/worker-release-broker-dispatch.mjs"),
        InstallFile("broker-policy.mjs", source("vps-workers/lib/worker-release-broker.mjs"), 0o440, helper_root / "lib/worker-release-broker.mjs"),
        InstallFile("github-proof.mjs", source("vps-workers/lib/worker-release-github-proof.mjs"), 0o440, helper_root / "lib/worker-release-github-proof.mjs"),
        InstallFile("quiesce.sh", source("vps-workers/lib/worker-release-quiesce-lease.sh"), 0o550, helper_root / "worker-release-quiesce-lease.sh"),
        InstallFile("health-check", source("vps-workers/bin/worker-release-health-check"), 0o550, helper_root / "worker-release-health-check"),
        InstallFile("archive-launcher", source("vps-workers/bin/worker_release_archive_extract_launcher.py"), 0o550,
                    helper_root / "worker_release_archive_extract_launcher.py", "baci-release-extractor"),
        InstallFile("broker-start", START_BROKER.encode(), 0o550, helper_root / "start-broker.sh"),
        InstallFile("dispatcher-wrapper", DISPATCHER_WRAPPER.encode(), 0o550, helper_root / "worker-release-broker-dispatch.mjs"),
        InstallFile("systemd-unit", UNIT.encode(), 0o644, unit_path),
    ]
    installed_names = {file.destination.name for file in files
                       if file.destination.parent == helper_root}
    # All mutable broker/control code is published atomically in a generation.
    # Only the fixed launcher ABI remains at the stable helper path.
    for module in runtime_modules:
        filename = f"{module}.py"
        if filename not in installed_names:
            source_relative = (
                f"vps-workers/tools/nonproduction-worker-release/{filename}"
                if module.startswith("dependency_seed_")
                else f"vps-workers/bin/{filename}"
            )
            files.append(InstallFile(f"broker-runtime-{module}",
                                     source(source_relative),
                                     0o440, helper_root / filename))
    return tuple(files)


def build_provisioning_plan(*, release: str, home: Path, helper_root: Path,
                            runtime_view_root: Path, state_root: Path,
                            pointer_root: Path, transaction_root: Path) -> tuple[tuple[str, ...], ...]:
    return (
        ("groupadd", "--system", release),
        ("useradd", "--system", "--gid", release, "--home-dir", str(home), "--no-create-home", "--shell", "/usr/sbin/nologin", release),
        ("install", "-d", "-o", release, "-g", release, "-m", "0700", str(home)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(helper_root)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(helper_root / "bin")),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(helper_root / "lib")),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0711", str(runtime_view_root)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0755", str(state_root)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0711", str(pointer_root)),
        ("install", "-d", "-o", "root", "-g", "root", "-m", "0700", str(transaction_root)),
        ("systemctl", "daemon-reload"),
        ("systemctl", "enable", "--now", "baci-worker-release-broker.service"),
    )




__all__ = ["InstallFile", "UNIT", "START_BROKER", "DISPATCHER_WRAPPER",
           "build_install_files", "build_provisioning_plan"]
