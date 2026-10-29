"""Verify the exact effective systemd sandbox for the isolated extractor."""
from __future__ import annotations

import re
import stat
from pathlib import Path


class UnitContractRejected(RuntimeError):
    """The loaded unit differs from the fixed extractor policy."""


def control_group_category(control_group: str, *, unit: str) -> str:
    """Classify a cgroup path without returning it or any caller-controlled text."""
    expected = f"/system.slice/{unit}"
    if control_group == expected:
        return "expected-system-slice"
    if not control_group:
        return "empty"
    nested = re.fullmatch(r"/system\.slice/[^/]+\.slice/" + re.escape(unit), control_group)
    return "nested-template-slice" if nested else "other"


def expected_properties(*, extractor: str, resource_root: Path,
                        control_root: Path) -> dict[str, str]:
    return {
        "Type": "simple", "User": extractor, "Group": extractor,
        "SupplementaryGroups": "", "DropInPaths": "", "Delegate": "no",
        "Slice": "system.slice",
        "KillMode": "control-group", "Restart": "no", "RuntimeMaxUSec": "3min",
        "TimeoutStartUSec": "20s", "TimeoutStopUSec": "5s", "NoNewPrivileges": "yes",
        "PrivateTmp": "yes", "PrivateDevices": "yes", "PrivateNetwork": "yes",
        "ProtectHome": "yes", "ProtectSystem": "strict", "ProtectControlGroups": "yes",
        "ProtectKernelTunables": "yes", "ProtectKernelModules": "yes",
        "ProtectKernelLogs": "yes", "ProtectProc": "invisible", "ProcSubset": "pid",
        "LockPersonality": "yes", "RestrictAddressFamilies": "AF_UNIX",
        "RestrictRealtime": "yes", "RestrictSUIDSGID": "yes", "UMask": "0077",
        "MemoryMax": "805306368", "TasksMax": "16", "CPUQuotaPerSecUSec": "1s",
        "StandardOutput": "null", "StandardError": "null",
        "ReadWritePaths": f"{resource_root} {control_root}",
        "ReadOnlyPaths": "/usr/local/lib/baci-worker-broker",
        "InaccessiblePaths": "/srv/baci-workers /etc /root /home",
    }


def validate_unit_contract(*, unit: str, transaction_id: str, extractor_uid: int,
                           extractor_gid: int, unit_file: Path, extractor: str,
                           unit_prefix: str, resource_root: Path, control_root: Path,
                           run, pid_identity, trusted_uid: int = 0) -> tuple[int, str]:
    """Check all security-relevant effective unit properties before sending bytes."""
    if run("systemctl", "show", "-p", "FragmentPath", "--value", unit) != str(unit_file):
        raise UnitContractRejected("extractor unit source is not the fixed installed template")
    try:
        metadata = unit_file.lstat()
    except OSError as error:
        raise UnitContractRejected("extractor unit file is unavailable") from error
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != trusted_uid
            or stat.S_IMODE(metadata.st_mode) != 0o644):
        raise UnitContractRejected("extractor unit file ownership or mode is unsafe")

    if unit != f"{unit_prefix}{transaction_id}.service":
        raise UnitContractRejected("extractor systemd instance name is not fixed")
    expected = expected_properties(extractor=extractor, resource_root=resource_root,
                                   control_root=control_root)
    observed = {name: run("systemctl", "show", "-p", name, "--value", unit)
                for name in expected}
    if observed != expected:
        raise UnitContractRejected("extractor effective systemd properties differ from fixed sandbox")

    command = run("systemctl", "show", "-p", "ExecStart", "--value", unit)
    match = re.search(r"argv\[\]=(.*?)\s*;", command)
    expected_exec = (f"/usr/bin/python3 -I -B /usr/local/lib/baci-worker-broker/"
                     f"worker_release_archive_extract_child.py {transaction_id}")
    if not match or match.group(1) != expected_exec:
        raise UnitContractRejected("extractor executable differs from fixed helper")
    try:
        pid = int(run("systemctl", "show", "-p", "MainPID", "--value", unit))
    except ValueError as error:
        raise UnitContractRejected("extractor systemd main process is invalid") from error
    control_group = run("systemctl", "show", "-p", "ControlGroup", "--value", unit)
    cgroup_class = control_group_category(control_group, unit=unit)
    if cgroup_class != "expected-system-slice":
        raise UnitContractRejected(
            f"extractor cgroup name differs from fixed instance ({cgroup_class})")
    if pid <= 1:
        raise UnitContractRejected("extractor systemd main process is unavailable")
    pid_identity(pid, extractor_uid, extractor_gid)
    return pid, control_group
