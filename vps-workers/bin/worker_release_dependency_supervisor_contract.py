"""Effective systemd properties required for the credential-free builder unit."""
from __future__ import annotations

from pathlib import Path
import grp
import pwd
from typing import Callable

from worker_release_dependency_policy_cache import RECEIPT_NAME
from worker_release_dependency_sandbox import WORKER_LOCKS, WORKER_RELEASES, WORKER_RUNTIME

MAX_BUILD_SECONDS = 300
_REQUIRED_ADDRESS_FAMILIES = frozenset({"AF_UNIX", "AF_INET", "AF_INET6"})


def _address_families_match(actual: str) -> bool:
    """Compare systemd's rendered list without relying on its token order."""
    families = actual.split()
    return len(families) == len(_REQUIRED_ADDRESS_FAMILIES) and frozenset(families) == _REQUIRED_ADDRESS_FAMILIES


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
        "LockPersonality": "yes",
        "TasksMax": "128", "MemoryMax": str(2 * 1024 * 1024 * 1024),
        # `systemctl show --value` renders usec properties as human durations.
        # Keep these exact so a wider quota or unbounded runtime fails closed.
        "CPUQuotaPerSecUSec": "2s", "RuntimeMaxUSec": "5min",
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
    if not _address_families_match(
            query("show", "--property=RestrictAddressFamilies", "--value", unit)):
        raise BuilderUnitContractRejected(
            "builder unit RestrictAddressFamilies differs from fixed policy")
    for key, allowed in identity_options.items():
        if query("show", f"--property={key}", "--value", unit) not in allowed:
            raise BuilderUnitContractRejected(f"builder unit {key} differs from fixed policy")


__all__ = ["BuilderUnitContractRejected", "validate_builder_unit"]
