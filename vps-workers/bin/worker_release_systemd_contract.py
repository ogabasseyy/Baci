"""Verify the exact effective systemd sandbox for the isolated extractor."""
from __future__ import annotations

import re
import stat
import os
from pathlib import Path
from worker_release_descriptor_cgroup import require_empty_cgroup
from worker_release_descriptor_process import assert_no_uid_processes


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


def credential_mismatch(status: str, uid: int, gid: int) -> str | None:
    """Classify /proc credentials without returning raw identity values."""
    found = {}
    try:
        for line in status.splitlines():
            if line.startswith(("Uid:", "Gid:", "Groups:")):
                key, value = line.split(":", 1)
                found[key] = tuple(int(item) for item in value.split())
    except (ValueError, TypeError):
        return "status-shape"
    if found.get("Uid") != (uid, uid, uid, uid):
        return "uid"
    if found.get("Gid") != (gid, gid, gid, gid):
        return "gid"
    # systemd initializes supplementary memberships from the account database;
    # SupplementaryGroups= only configures unit assignments, it does not replace
    # those defaults. Provisioning pins that database list to [gid].
    if found.get("Groups") not in ((), (gid,)):
        return "supplementary-groups"
    return None


def unit_cgroup_removed(unit: str, transaction_id: str, *, cgroup_root: Path,
                        run) -> bool:
    """Prove systemd removed this exact instance cgroup after its process exited."""
    if unit != f"baci-worker-source-extract@{transaction_id}.service":
        return False
    try:
        if (run("systemctl", "show", "-p", "ActiveState", "--value", unit) != "inactive"
                or run("systemctl", "show", "-p", "ControlGroup", "--value", unit) != ""):
            return False
        root_fd = os.open(cgroup_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            slice_fd = os.open("system.slice", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                               dir_fd=root_fd)
            try:
                try:
                    instance_fd = os.open(unit, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                          dir_fd=slice_fd)
                except FileNotFoundError:
                    return True
                else:
                    os.close(instance_fd)
                    return False
            finally:
                os.close(slice_fd)
        finally:
            os.close(root_fd)
    except OSError:
        return False


def require_cgroup_empty_after_stop(cgroup_fd: int, cgroup_info, *, unit: str,
                                    transaction_id: str, extractor_uid: int,
                                    contract_verified: bool, cgroup_root: Path, run) -> None:
    try:
        require_empty_cgroup(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino)
    except FileNotFoundError:
        # A verified cgroup may disappear when systemd removes its empty unit.
        # This relies on the broker's trusted-root deployment model: no
        # concurrent privileged actor restarts this exact transaction unit.
        # Recheck its state/path after scanning for the dedicated UID to narrow
        # the remaining lifecycle race; every uncertainty fails closed.
        if (not contract_verified or not unit_cgroup_removed(
                unit, transaction_id, cgroup_root=cgroup_root, run=run)):
            raise
        assert_no_uid_processes(extractor_uid)
        if not unit_cgroup_removed(unit, transaction_id, cgroup_root=cgroup_root, run=run):
            raise UnitContractRejected("extractor unit changed during empty-cgroup proof")


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
        "ReadOnlyPaths": "/usr/local/lib/baci-worker-broker /var/lib/baci-worker-broker/pointer",
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
                     f"worker_release_archive_extract_launcher.py {transaction_id}")
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
