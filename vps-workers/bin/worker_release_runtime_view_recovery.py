"""Recover abandoned runtime views only after exact systemd/cgroup proof."""
from __future__ import annotations

import os
import subprocess
import time
import stat
from pathlib import Path

from worker_release_dependency_supervisor_cgroup import (
    preflight_cgroup_root, prove_collected_unit, stop_unit,
)
from worker_release_runtime_view import (
    DIR_FLAGS, RuntimeViewRejected, VIEW_ROOT, _open_view_root, _require_dir,
)
from worker_release_runtime_view_journal import (
    RuntimeViewJournalRejected, RuntimeViewRecord, list_all_runtime_view_records,
    remove_runtime_view_record, verify_runtime_view_record,
)
from worker_release_runtime_identity import RuntimeIdentityRejected, runtime_verifier_identity

SYSTEMCTL = "/usr/bin/systemctl"
CGROUP_ROOT = Path("/sys/fs/cgroup")
RECOVERY_SECONDS = 30


class RuntimeViewRecoveryRejected(RuntimeError):
    """An abandoned runtime view could not be safely proven and removed."""


def _query(deadline: float, *args: str) -> str:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RuntimeViewRecoveryRejected("runtime-view recovery deadline expired")
    try:
        result = subprocess.run((SYSTEMCTL, *args), check=True, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=min(1.0, remaining), text=True,
                                env={"PATH": "/usr/bin:/bin"})
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeViewRecoveryRejected("runtime-view systemd proof query failed") from error
    value = result.stdout.strip()
    if len(value) > 256 or "\n" in value or "\r" in value:
        raise RuntimeViewRecoveryRejected("runtime-view systemd proof is outside its bound")
    return value


def _prove_unit_gone(unit: str, runtime_uid: int) -> None:
    if type(runtime_uid) is not int or runtime_uid <= 0:
        raise RuntimeViewRecoveryRejected("runtime-view identity is invalid")
    if os.geteuid() != 0:
        raise RuntimeViewRecoveryRejected("runtime-view recovery requires root")
    try:
        trusted_root = preflight_cgroup_root(CGROUP_ROOT)
    except Exception as error:
        raise RuntimeViewRecoveryRejected("runtime-view cgroup boundary is unavailable") from error
    stop_unit(SYSTEMCTL, unit)
    deadline = time.monotonic() + RECOVERY_SECONDS
    def query(*args: str, timeout: float = 1) -> str:
        return _query(min(deadline, time.monotonic() + timeout), *args)
    try:
        load = query("show", "--property=LoadState", "--value", unit)
        active = query("show", "--property=ActiveState", "--value", unit)
        if load == "loaded" and active in ("inactive", "failed"):
            try:
                subprocess.run((SYSTEMCTL, "reset-failed", unit), check=False,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=1,
                               env={"PATH": "/usr/bin:/bin"})
            except (OSError, subprocess.SubprocessError):
                pass
        prove_collected_unit(unit, None, root=CGROUP_ROOT, uid=runtime_uid,
                             deadline=deadline, query=query, trusted_root=trusted_root)
    except Exception as error:
        raise RuntimeViewRecoveryRejected(
            "runtime-view transient unit and cgroup absence were not proven") from error


def recover_runtime_view(record: RuntimeViewRecord, *,
                         view_root: Path = VIEW_ROOT) -> None:
    """Stop and prove the recorded unit gone, then remove only its empty view.

    The caller must already hold the authenticated stage/release lock and must
    query this journal by the exact candidate inode recorded in its stage state.
    This function independently verifies the durable record, unit identity,
    systemd state, cgroup2 absence, runtime UID process table, and empty mountpoint.
    """
    if not isinstance(record, RuntimeViewRecord):
        raise RuntimeViewRecoveryRejected("runtime-view recovery record is invalid")
    try:
        expected_uid, _gid = runtime_verifier_identity()
    except RuntimeIdentityRejected as error:
        raise RuntimeViewRecoveryRejected("runtime verifier identity is unavailable") from error
    if record.runtime_uid != expected_uid:
        raise RuntimeViewRecoveryRejected("runtime-view record UID is outside fixed policy")
    try:
        current = list_all_runtime_view_records(view_root)
        if record not in current:
            raise RuntimeViewRecoveryRejected("runtime-view journal record is no longer present")
        _prove_unit_gone(record.unit, record.runtime_uid)
        root_fd = _open_view_root(view_root)
        try:
            root = os.fstat(root_fd)
            if ((root.st_dev, root.st_ino) != record.view_root_identity
                    or root.st_uid != 0 or root.st_gid != 0
                    or stat.S_IMODE(root.st_mode) != 0o711):
                raise RuntimeViewRecoveryRejected("runtime-view root identity changed")
            verify_runtime_view_record(root_fd, record)
            try:
                unit_info = os.stat(record.unit, dir_fd=root_fd, follow_symlinks=False)
            except FileNotFoundError:
                remove_runtime_view_record(root_fd, record)
                return
            if (not stat.S_ISDIR(unit_info.st_mode) or unit_info.st_uid != 0
                    or unit_info.st_gid != 0 or stat.S_IMODE(unit_info.st_mode) != 0o711):
                raise RuntimeViewRecoveryRejected("runtime-view unit directory is unsafe")
            unit_fd = os.open(record.unit, DIR_FLAGS, dir_fd=root_fd)
            try:
                _require_dir(unit_fd, mode=0o711)
                entries = set(os.listdir(unit_fd))
                if not entries:
                    os.close(unit_fd)
                    unit_fd = -1
                    os.rmdir(record.unit, dir_fd=root_fd)
                    os.fsync(root_fd)
                    remove_runtime_view_record(root_fd, record)
                    return
                if entries != {"candidate"}:
                    raise RuntimeViewRecoveryRejected("runtime-view unit directory is not exact")
                candidate_fd = os.open("candidate", DIR_FLAGS, dir_fd=unit_fd)
                try:
                    _require_dir(candidate_fd, mode=0o700)
                    if os.listdir(candidate_fd):
                        raise RuntimeViewRecoveryRejected("runtime-view mountpoint is not empty")
                finally:
                    os.close(candidate_fd)
                os.rmdir("candidate", dir_fd=unit_fd)
                os.fsync(unit_fd)
            finally:
                if unit_fd >= 0:
                    os.close(unit_fd)
            os.rmdir(record.unit, dir_fd=root_fd)
            os.fsync(root_fd)
            remove_runtime_view_record(root_fd, record)
        finally:
            os.close(root_fd)
    except (OSError, RuntimeViewRejected, RuntimeViewJournalRejected) as error:
        raise RuntimeViewRecoveryRejected("runtime-view recovery failed closed") from error


__all__ = ["RuntimeViewRecoveryRejected", "recover_runtime_view"]
