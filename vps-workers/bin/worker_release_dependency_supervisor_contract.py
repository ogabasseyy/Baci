"""Effective systemd properties required for the credential-free builder unit."""
from __future__ import annotations

from pathlib import Path
import grp
import pwd
from typing import Callable

from worker_release_dependency_policy_cache import RECEIPT_NAME
from worker_release_dependency_sandbox import WORKER_LOCKS, WORKER_RELEASES, WORKER_RUNTIME

MAX_BUILD_SECONDS = 300


class BuilderUnitContractRejected(RuntimeError):
    """The active systemd unit differs from the fixed sandbox contract."""


def validate_builder_unit(query: Callable[..., str], unit: str, cgroup_path: str,
                          uid: int, gid: int, source: Path, scratch: Path) -> None:
    expected = {
        "ControlGroup": cgroup_path,
        "SupplementaryGroups": "", "Delegate": "no", "KillMode": "control-group",
        "NoNewPrivileges": "yes", "PrivateNetwork": "yes", "ProtectSystem": "strict",
        "ProtectHome": "yes", "PrivateTmp": "yes", "PrivateDevices": "yes",
        "PrivateUsers": "yes", "ProtectControlGroups": "yes", "ProtectKernelTunables": "yes",
        "ProtectKernelModules": "yes", "ProtectKernelLogs": "yes", "ProtectProc": "invisible",
        "ProcSubset": "pid", "RestrictSUIDSGID": "yes", "RestrictRealtime": "yes",
        "LockPersonality": "yes", "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6",
        "TasksMax": "128", "MemoryMax": str(2 * 1024 * 1024 * 1024),
        "CPUQuotaPerSecUSec": "2000000", "RuntimeMaxUSec": str(MAX_BUILD_SECONDS * 1_000_000),
        "LimitFSIZE": str(1024 * 1024 * 1024), "UMask": "0077",
        "ReadOnlyPaths": f"{source} {source.parent / 'pnpm-cache-seed'} {source.parent / RECEIPT_NAME}",
        "ReadWritePaths": str(scratch),
        "InaccessiblePaths": f"{WORKER_RUNTIME} {WORKER_RELEASES} {WORKER_LOCKS}",
    }
    identity_options = {
        "User": {str(uid), pwd.getpwuid(uid).pw_name},
        "Group": {str(gid), grp.getgrgid(gid).gr_name},
        "LimitNOFILE": {"4096", "4096:4096"},
    }
    for key, value in expected.items():
        if query("show", f"--property={key}", "--value", unit) != value:
            raise BuilderUnitContractRejected(f"builder unit {key} differs from fixed policy")
    for key, allowed in identity_options.items():
        if query("show", f"--property={key}", "--value", unit) not in allowed:
            raise BuilderUnitContractRejected(f"builder unit {key} differs from fixed policy")


__all__ = ["BuilderUnitContractRejected", "validate_builder_unit"]
