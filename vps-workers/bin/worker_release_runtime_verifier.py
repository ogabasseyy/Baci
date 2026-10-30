"""Fixed-policy runtime verification for a materialized release.

Staging calls this before publishing a candidate. It can only issue an
in-process receipt after bounded checks run in a secretless systemd sandbox
against a descriptor-pinned candidate tree.

The contract tests are portable; only the required disposable Linux/systemd
workflow exercises the real sandbox invocation. Pinning assumes the trusted
root broker holds the release lock and no concurrent privileged actor mutates
or replaces the candidate; the smoke process itself runs under a dedicated,
non-login verifier UID and cannot write the pinned tree.
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
from pathlib import Path

from worker_release_candidate_pin import CandidatePinRejected, pin_candidate
from worker_release_dependency_supervisor_cgroup import (
    drain_unpinned_until_proven, preflight_cgroup_root,
)
from worker_release_lifecycle import AuthenticatedRun, LifecycleRejected
from worker_release_runtime_diagnostics import (
    BoundedLauncherStderr, MAX_CAPTURE_BYTES, summarize_unit_exit,
)
from worker_release_runtime_smoke import run_fixed_smokes
from worker_release_runtime_acl import (
    RuntimeAclRejected, grant_candidate_acl, verifier_gid, verifier_uid,
)
from worker_release_runtime_receipt import (
    ACCESS_POLICY, RECEIPT_SEAL as _RECEIPT_SEAL, RuntimeVerificationReceipt,
    VERIFIER_VERSION, validate_runtime_receipt,
)

MAX_CHECK_SECONDS = 35
MAX_LAUNCH_SECONDS = 5
MAX_CLEANUP_SECONDS = 30
POLL_SECONDS = 0.05
CGROUP_ROOT = Path("/sys/fs/cgroup")
SYSTEMD_RUN = "/usr/bin/systemd-run"
SYSTEMCTL = "/usr/bin/systemctl"
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_DIGEST_RE = re.compile(r"^[0-9a-f]{64}$")


class RuntimeVerificationRejected(RuntimeError):
    """Candidate verification failed; messages intentionally contain no output."""


class RuntimeVerificationQuiescenceUnproven(RuntimeVerificationRejected):
    """The exact transient smoke unit could not be proven stopped and empty."""

    preserve_candidate_required = True


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
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE, env={"PATH": "/usr/bin:/bin"},
                                   start_new_session=True, close_fds=True)
        if process.stderr is not None:
            process._baci_stderr_capture = BoundedLauncherStderr(process.stderr)
        return process
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
    runtime_uid = verifier_uid()
    if properties.get("User") != str(runtime_uid):
        raise RuntimeVerificationRejected("runtime unit identity is outside fixed policy")
    try:
        trusted_root = preflight_cgroup_root(CGROUP_ROOT)
    except Exception as error:
        raise RuntimeVerificationRejected("required cgroup v2 runtime boundary is unavailable") from error
    if (not isinstance(trusted_root, tuple) or len(trusted_root) != 4
            or any(type(value) is not int or value < 0 for value in trusted_root)):
        raise RuntimeVerificationRejected("trusted cgroup v2 runtime identity is invalid")
    # Keep failed units inspectable until Result/ExecMainStatus are read. The
    # default inactive collection mode removes the exact transient unit after
    # the explicit drain transitions it to inactive.
    invocation = [SYSTEMD_RUN, "--quiet", "--no-block", f"--unit={unit}"]
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
            capture = getattr(process, "_baci_stderr_capture", None)
            category = capture.category() if capture is not None else "unit-launch-rejected"
            property_hint = (capture.property_hint(tuple(properties))
                             if capture is not None and category == "unit-property-rejected" else None)
            safe_property = f" property={property_hint}" if property_hint is not None else ""
            failure = f"transient unit launch was rejected ({category}){safe_property}"
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
                    summary = summarize_unit_exit(values, expected_cgroup=expected_cgroup)
                    failure = (
                        f"fixed runtime check {check_index} exited unsuccessfully ({summary})"
                    )
                break
            if load != "loaded":
                failure = f"fixed runtime check {check_index} unit disappeared before terminal verification"
                break
            if active == "failed":
                status = _systemctl("show", "--property=ExecMainStatus", "--value", unit)
                if re.fullmatch(r"(?:0|[1-9][0-9]{0,2})", status) and int(status) <= 255:
                    failure = f"fixed runtime check {check_index} failed (exit={status})"
                else:
                    failure = f"fixed runtime check {check_index} failed"
                break
            if active == "inactive":
                failure = f"fixed runtime check {check_index} became inactive before verification"
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
                def drain_query(*args: str, timeout: float = 1) -> str:
                    value = _systemctl(*args, timeout=timeout)
                    # drain_unpinned_until_proven calls this only after its
                    # cgroup lookup proved the exact unit cgroup absent. A
                    # failed unit remains loaded after --collect is removed,
                    # so clear that terminal systemd state only after the
                    # empty-cgroup proof, then require exact unload.
                    if (args == ("show", "--property=LoadState", "--value", unit)
                            and value == "loaded"):
                        active = _systemctl("show", "--property=ActiveState", "--value", unit,
                                            timeout=timeout)
                        if active in ("inactive", "failed"):
                            _systemctl("reset-failed", unit, timeout=timeout)
                            value = _systemctl(*args, timeout=timeout)
                            if value != "not-found":
                                raise RuntimeVerificationRejected(
                                    "terminal runtime unit could not be unloaded after drain proof")
                    return value

                drain_unpinned_until_proven(
                    unit, process, root=CGROUP_ROOT, systemctl=SYSTEMCTL,
                    query=drain_query,
                    rejected=RuntimeVerificationRejected,
                    deadline=time.monotonic() + MAX_CLEANUP_SECONDS,
                    unproven=RuntimeVerificationQuiescenceUnproven,
                    uid=runtime_uid, trusted_root=trusted_root,
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


def _run_fixed_smokes(candidate: Path, fence_digest: str,
                      runtime_gid: int | None = None) -> tuple[str, ...]:
    """Execute only fixed package checks in bounded, drained systemd units."""
    return run_fixed_smokes(
        candidate, fence_digest, execute_unit=_execute_fixed_unit, unit_name=_unit_name,
        rejected=RuntimeVerificationRejected, max_seconds=MAX_CHECK_SECONDS,
        max_output_bytes=MAX_CAPTURE_BYTES, systemd_run=SYSTEMD_RUN, systemctl=SYSTEMCTL,
        runtime_uid=verifier_uid(),
        runtime_gid=verifier_gid() if runtime_gid is None else runtime_gid,
    )


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
        verifier_group = verifier_gid()
        grant_candidate_acl(Path(candidate), expected_sha=identity.sha, owner_uid=owner_uid,
                            owner_gid=owner_gid, gid=verifier_group)
        pin_context = pin_candidate(Path(candidate), expected_sha=identity.sha, owner_uid=owner_uid,
                                    owner_gid=owner_gid, verifier_gid=verifier_group)
    except (CandidatePinRejected, RuntimeAclRejected, OSError, UnicodeError) as error:
        raise RuntimeVerificationRejected("candidate failed bounded inode and tree validation") from error
    with pin_context as pin:
        fence_digest = hashlib.sha256(
            repr((fence, archive_sha256, pin.digest, *pin.candidate_identity[:2])).encode("utf-8")
        ).hexdigest()
        checks = _run_fixed_smokes(pin.path, fence_digest, pin.verifier_gid)
        pin.verify_unchanged()
        return RuntimeVerificationReceipt(fence, archive_sha256, pin.digest,
                                          pin.candidate_identity[0], pin.candidate_identity[1],
                                          verifier_uid(), VERIFIER_VERSION, pin.verifier_gid, ACCESS_POLICY,
                                          checks, _RECEIPT_SEAL)


__all__ = ["RuntimeVerificationReceipt", "RuntimeVerificationRejected", "validate_runtime_receipt", "verify_materialized_candidate"]
