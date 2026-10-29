"""Disconnected, fixed-policy runtime verification for a materialized release.

This module is intentionally not wired into staging or promotion. It can only
issue an in-process receipt after bounded checks run in a secretless systemd
sandbox against a descriptor-pinned candidate tree.

The contract tests are portable; only the required disposable Linux/systemd
workflow exercises the real sandbox invocation. Pinning assumes the trusted
root broker holds the release lock and no concurrent privileged actor mutates
or replaces the candidate; the smoke process itself runs as nobody and cannot
write the pinned tree.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from worker_release_candidate_pin import CandidatePinRejected, pin_candidate
from worker_release_dependency_supervisor_cgroup import (
    drain_unpinned_until_proven, preflight_cgroup_root,
)
from worker_release_lifecycle import AuthenticatedRun, LifecycleRejected

VERIFIER_VERSION = "materialized-worker-runtime-v1"
MAX_CAPTURE_BYTES = 4096
MAX_CHECK_SECONDS = 35
MAX_LAUNCH_SECONDS = 5
MAX_CLEANUP_SECONDS = 30
POLL_SECONDS = 0.05
CGROUP_ROOT = Path("/sys/fs/cgroup")
SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")
_RECEIPT_SEAL = object()


class RuntimeVerificationRejected(RuntimeError):
    """Candidate verification failed; messages intentionally contain no output."""


class RuntimeVerificationQuiescenceUnproven(RuntimeVerificationRejected):
    """The exact transient smoke unit could not be proven stopped and empty."""

    preserve_candidate_required = True


@dataclass(frozen=True)
class RuntimeVerificationReceipt:
    """In-process proof token; it is deliberately not serializable or portable."""

    fence: tuple[tuple[str, object], ...]
    archive_sha256: str
    candidate_sha256: str
    candidate_dev: int
    candidate_ino: int
    verifier_version: str
    checks: tuple[str, ...]
    _seal: object


def _systemctl(*args: str, timeout: float = 1) -> str:
    try:
        result = subprocess.run((SYSTEMCTL, *args), check=True, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=timeout, text=True, env={"PATH": "/usr/bin:/bin"})
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeVerificationRejected("systemd runtime state query failed") from error
    value = result.stdout.strip()
    if len(value) > 256 or "\n" in value or "\r" in value:
        raise RuntimeVerificationRejected("systemd runtime state is outside its bound")
    return value


def _spawn_unit(command: tuple[str, ...]) -> subprocess.Popen:
    try:
        return subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, env={"PATH": "/usr/bin:/bin"},
                                start_new_session=True, close_fds=True)
    except OSError as error:
        raise RuntimeVerificationRejected("systemd runtime unit launch failed") from error


def _kill_launcher(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        raise RuntimeVerificationQuiescenceUnproven(
            "systemd runtime launcher process could not be reaped") from None


def _unit_name(fence_digest: str, index: int) -> str:
    if not re.fullmatch(r"[0-9a-f]{64}", fence_digest) or index not in (0, 1):
        raise RuntimeVerificationRejected("runtime unit identity is invalid")
    return f"baci-worker-runtime-{fence_digest[:16]}-{secrets.token_hex(6)}-{index}.service"


def _execute_fixed_unit(unit: str, cwd: Path, command: tuple[str, ...],
                        properties: dict[str, str], check_index: int) -> None:
    """Run one fixed unit, then stop/kill it and prove its cgroup empty on every path."""
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        raise RuntimeVerificationRejected("runtime verifier requires Linux root broker")
    if not Path(SYSTEMD_RUN).is_file() or not Path(SYSTEMCTL).is_file():
        raise RuntimeVerificationRejected("systemd runtime verifier is unavailable")
    if not re.fullmatch(r"baci-worker-runtime-[0-9a-f]{16}-[0-9a-f]{12}-[01]\.service", unit):
        raise RuntimeVerificationRejected("systemd runtime unit name is invalid")
    try:
        preflight_cgroup_root(CGROUP_ROOT)
    except Exception as error:
        raise RuntimeVerificationRejected("required cgroup v2 runtime boundary is unavailable") from error
    invocation = [SYSTEMD_RUN, "--quiet", "--no-block", "--collect", f"--unit={unit}"]
    invocation.extend(f"--property={key}={value}" for key, value in properties.items())
    invocation.extend(("--property=RemainAfterExit=yes", "--property=StandardOutput=null",
                       "--property=StandardError=null", f"--property=WorkingDirectory={cwd}",
                       "--", *command))
    process = None
    failure: str | None = None
    launcher_unproven = False
    try:
        process = _spawn_unit(tuple(invocation))
        try:
            process.wait(timeout=MAX_LAUNCH_SECONDS)
        except subprocess.TimeoutExpired:
            try:
                _kill_launcher(process)
            except RuntimeVerificationQuiescenceUnproven:
                launcher_unproven = True
            failure = "transient unit launch timed out"
        if failure is None and process.returncode != 0:
            failure = "transient unit launch was rejected"
        deadline = time.monotonic() + MAX_CHECK_SECONDS
        completed = False
        while failure is None and time.monotonic() < deadline:
            load = _systemctl("show", "--property=LoadState", "--value", unit)
            active = _systemctl("show", "--property=ActiveState", "--value", unit)
            substate = _systemctl("show", "--property=SubState", "--value", unit)
            if load == "not-found":
                failure = "transient unit disappeared before terminal verification"
                break
            if active == "active" and substate == "exited":
                values = {
                    "Result": _systemctl("show", "--property=Result", "--value", unit),
                    "ExecMainCode": _systemctl("show", "--property=ExecMainCode", "--value", unit),
                    "ExecMainStatus": _systemctl("show", "--property=ExecMainStatus", "--value", unit),
                    "MainPID": _systemctl("show", "--property=MainPID", "--value", unit),
                    "ControlGroup": _systemctl("show", "--property=ControlGroup", "--value", unit),
                }
                expected_cgroup = f"/system.slice/{unit}"
                if (values == {"Result": "success", "ExecMainCode": "exited",
                               "ExecMainStatus": "0", "MainPID": "0",
                               "ControlGroup": expected_cgroup}):
                    completed = True
                else:
                    failure = f"fixed runtime check {check_index} exited unsuccessfully"
                break
            if active in ("failed", "inactive") or load != "loaded":
                failure = f"fixed runtime check {check_index} did not reach successful exit"
                break
            time.sleep(POLL_SECONDS)
        if not completed and failure is None:
            failure = f"fixed runtime check {check_index} exceeded its runtime bound"
    except Exception:
        failure = f"fixed runtime check {check_index} failed safely"
    finally:
        if process is not None and process.poll() is None:
            try:
                _kill_launcher(process)
            except RuntimeVerificationQuiescenceUnproven:
                launcher_unproven = True
        if process is not None:
            try:
                drain_unpinned_until_proven(
                    unit, process, root=CGROUP_ROOT, systemctl=SYSTEMCTL,
                    query=lambda *args, timeout=1: _systemctl(*args, timeout=timeout),
                    rejected=RuntimeVerificationRejected,
                    deadline=time.monotonic() + MAX_CLEANUP_SECONDS,
                    unproven=RuntimeVerificationQuiescenceUnproven,
                )
            except RuntimeVerificationQuiescenceUnproven:
                raise
            except Exception as error:
                raise RuntimeVerificationQuiescenceUnproven(
                    "runtime unit stop and cgroup emptiness could not be proven") from error
    if launcher_unproven:
        raise RuntimeVerificationQuiescenceUnproven(
            "runtime unit launcher could not be reaped; preserve candidate")
    if failure is not None:
        raise RuntimeVerificationRejected(failure)


def _run_fixed_smokes(candidate: Path, fence_digest: str) -> tuple[str, ...]:
    """Execute only fixed package checks in bounded, drained systemd units."""
    if not sys.platform.startswith("linux") or os.geteuid() != 0:
        raise RuntimeVerificationRejected("runtime verifier requires Linux root broker")
    if not Path(SYSTEMD_RUN).is_file() or not Path(SYSTEMCTL).is_file():
        raise RuntimeVerificationRejected("systemd runtime verifier is unavailable")
    web = candidate / "apps" / "web"
    tsx = web / "node_modules" / ".bin" / "tsx"
    workers = candidate / "vps-workers"
    if (not tsx.is_file() or not os.access(tsx, os.X_OK) or not workers.is_dir()
            or not (candidate / "node_modules").is_dir()):
        raise RuntimeVerificationRejected("candidate is missing fixed runtime smoke targets")
    properties = {
        "User": "65534", "Group": "65534", "SupplementaryGroups": "",
        "NoNewPrivileges": "yes", "PrivateNetwork": "yes", "ProtectSystem": "strict",
        "ProtectHome": "yes", "PrivateTmp": "no", "PrivateDevices": "yes",
        "PrivateUsers": "yes", "ProtectControlGroups": "yes",
        "ProtectKernelTunables": "yes", "ProtectKernelModules": "yes",
        "ProtectKernelLogs": "yes", "ProtectProc": "invisible", "ProcSubset": "pid",
        "RestrictSUIDSGID": "yes", "RestrictRealtime": "yes",
        "CapabilityBoundingSet": "", "AmbientCapabilities": "",
        "RestrictAddressFamilies": "AF_UNIX", "TasksMax": "32",
        "MemoryMax": str(512 * 1024 * 1024), "CPUQuotaPerSecUSec": "1000000",
        "RuntimeMaxSec": str(MAX_CHECK_SECONDS), "LimitNOFILE": "256",
        "LimitFSIZE": str(MAX_CAPTURE_BYTES), "UMask": "0077",
        "ReadOnlyPaths": str(candidate),
        "InaccessiblePaths": "/root /home /run /var/run /tmp /var/tmp /dev/shm /etc/baci-workers /srv/baci-workers/runtime /srv/baci-workers/locks",
    }
    commands = (
        (web, ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production", str(tsx), "--version")),
        (workers, ("/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "NODE_ENV=production",
                   "/usr/bin/node", "--input-type=module", "-e",
                   "import('dotenv').then(m => { if (typeof m.config !== 'function') process.exit(2) })")),
    )
    for index, (cwd, command) in enumerate(commands):
        _execute_fixed_unit(_unit_name(fence_digest, index), cwd, command, properties, index + 1)
    return ("web_tsx_version", "worker_dotenv_import")


def verify_materialized_candidate(candidate: Path, identity: AuthenticatedRun, *,
                                  archive_sha256: str, owner_uid: int = 0,
                                  owner_gid: int) -> RuntimeVerificationReceipt:
    """Pin and smoke-check an exact incoming release; this never promotes it.

    The caller must preserve the candidate if RuntimeVerificationQuiescenceUnproven
    is raised. This API never deletes or publishes candidate data.
    """
    if not isinstance(identity, AuthenticatedRun):
        raise RuntimeVerificationRejected("authenticated archive binding is invalid")
    try:
        identity = AuthenticatedRun.from_broker(
            identity.fence() | {"status": identity.status}, expected_sha=identity.sha)
    except LifecycleRejected as error:
        raise RuntimeVerificationRejected("authenticated archive binding is invalid") from error
    if (not isinstance(archive_sha256, str) or not _DIGEST_RE.fullmatch(archive_sha256)
            or identity.status != "in_progress" or not _SHA_RE.fullmatch(identity.sha)):
        raise RuntimeVerificationRejected("authenticated archive binding is invalid")
    fence = tuple(sorted(identity.fence().items()))
    try:
        pin_context = pin_candidate(Path(candidate), expected_sha=identity.sha, owner_uid=owner_uid, owner_gid=owner_gid)
    except (CandidatePinRejected, OSError, UnicodeError) as error:
        raise RuntimeVerificationRejected("candidate failed bounded inode and tree validation") from error
    with pin_context as pin:
        fence_digest = hashlib.sha256(
            repr((fence, archive_sha256, pin.digest, *pin.candidate_identity[:2])).encode("utf-8")
        ).hexdigest()
        checks = _run_fixed_smokes(pin.path, fence_digest)
        pin.verify_unchanged()
        return RuntimeVerificationReceipt(fence, archive_sha256, pin.digest,
                                          pin.candidate_identity[0], pin.candidate_identity[1],
                                          VERIFIER_VERSION, checks, _RECEIPT_SEAL)


def validate_runtime_receipt(receipt: object, candidate: Path, identity: AuthenticatedRun,
                             archive_sha256: str, *, owner_uid: int = 0,
                             owner_gid: int) -> bool:
    """Validate only a receipt minted by this module for the unchanged candidate."""
    if (not isinstance(identity, AuthenticatedRun) or identity.status != "in_progress"
            or not _SHA_RE.fullmatch(identity.sha) or not isinstance(archive_sha256, str)
            or not _DIGEST_RE.fullmatch(archive_sha256)
            or not isinstance(receipt, RuntimeVerificationReceipt) or receipt._seal is not _RECEIPT_SEAL
            or receipt.verifier_version != VERIFIER_VERSION
            or receipt.checks != ("web_tsx_version", "worker_dotenv_import")
            or receipt.archive_sha256 != archive_sha256
            or receipt.fence != tuple(sorted(identity.fence().items()))):
        return False
    try:
        with pin_candidate(Path(candidate), expected_sha=identity.sha, owner_uid=owner_uid, owner_gid=owner_gid) as pin:
            pin.verify_unchanged()
            return (pin.digest == receipt.candidate_sha256
                    and (pin.candidate_identity[0], pin.candidate_identity[1])
                    == (receipt.candidate_dev, receipt.candidate_ino))
    except (OSError, RuntimeVerificationRejected, CandidatePinRejected):
        return False

__all__ = ["RuntimeVerificationReceipt", "RuntimeVerificationRejected", "validate_runtime_receipt", "verify_materialized_candidate"]
