"""Fixed operation dispatcher for the privileged worker release broker."""
from typing import Any, Callable
import worker_release_broker as broker
import stat

def _health_after_restart(lease, probe):
    """Probe under an explicit live gate; unexpected EOF stops the units."""
    lease.start_health()
    return probe()

def make_fixed_release_dispatch(*, release_uid: int, worker_uid: int, worker_gid: int) -> Callable[[int, dict[str, Any]], dict[str, Any]]:
    """Build fixed release operations; commands and filesystem targets are constants."""
    if broker.os.geteuid() != 0 or release_uid <= 0 or worker_uid <= 0 or worker_gid < 0 or release_uid == worker_uid:
        raise PermissionError("invalid trusted broker execution context")
    broker._assert_root_owned_executable(broker.TRUSTED_NODE)
    broker._assert_root_owned_executable(broker.TRUSTED_DISPATCHER)
    if broker.os.path.realpath(broker.WORKER_ROOT) != broker.WORKER_ROOT:
        raise PermissionError("worker root must not contain symlinks")
    worker_metadata = broker.os.stat(broker.WORKER_ROOT, follow_symlinks=False)
    releases_root = broker.os.path.join(broker.WORKER_ROOT, "releases")
    releases_metadata = broker.os.stat(releases_root, follow_symlinks=False)
    for metadata in (worker_metadata, releases_metadata):
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise PermissionError("worker release parents must be root-owned and not group/world writable")

    # The broker process owns the helper pipe for the whole promote -> health
    # window. A fresh manager is created per trusted broker process; process
    # exit closes the pipe and lets the helper's cleanup trap release locks.
    from worker_release_quiesce_lease import WorkerQuiesceLeaseManager
    quiescence = WorkerQuiesceLeaseManager(worker_uid=worker_uid, worker_gid=worker_gid)

    def dispatch(peer_uid: int, request: dict[str, Any]) -> dict[str, Any]:
        if peer_uid != release_uid or request.get("operation") not in ("stage", "preflight", "readiness", "gigl-capability", "recovery-status", "recover", "promote", "health", "rollback"):
            raise broker.BrokerProtocolError("unsupported broker operation")
        # No shell, cwd selection, PATH inheritance, or caller-selected executable.
        child_env = {
            "PATH": "/usr/bin:/bin",
            "HOME": "/root",
            "BACI_BROKER_PEER_UID": str(peer_uid),
            "BACI_BROKER_RELEASE_UID": str(release_uid),
            "BACI_BROKER_WORKER_UID": str(worker_uid),
            "BACI_BROKER_AUTHENTICATED_PEER": "kernel",
        }
        completed = broker.subprocess.run(
            [broker.TRUSTED_NODE, broker.TRUSTED_DISPATCHER], input=broker.json.dumps(request).encode("utf-8") + b"\n",
            stdout=broker.subprocess.PIPE, stderr=broker.subprocess.DEVNULL, check=False, close_fds=True,
            cwd="/", env=child_env, timeout=broker.DISPATCHER_TIMEOUT_SECONDS,
        )
        if completed.returncode != 0 or len(completed.stdout) > (broker.MAX_ARCHIVE_COMPRESSED_BYTES * 4 // 3 + 1024 * 1024):
            raise broker.BrokerProtocolError("coordinator authentication failed")
        try:
            verified = broker.json.loads(completed.stdout)
            sha = verified["sourceSha"]
            operation = verified["operation"]
            run_id = verified["runId"]
            run_attempt = verified["runAttempt"]
            job_id = verified["jobId"]
            repository = verified["repository"]
            workflow = verified["workflow"]
            ref = verified["ref"]
            status = verified["status"]
        except (broker.json.JSONDecodeError, KeyError, TypeError):
            raise broker.BrokerProtocolError("trusted dispatcher returned invalid data") from None
        if not broker.re.fullmatch(r"[0-9a-f]{40}", sha) or operation != request.get("operation") or not broker.re.fullmatch(r"[1-9][0-9]{0,19}", str(run_id)) or not isinstance(run_attempt, int) or run_attempt < 1 or not broker.re.fullmatch(r"[1-9][0-9]{0,19}", str(job_id)):
            raise broker.BrokerProtocolError("trusted dispatcher returned invalid source identity")
        recovery_of = verified.get("recoveryOf")
        fence = {"run_id": str(run_id), "run_attempt": run_attempt, "sha": sha}
        if operation in ("stage", "readiness", "gigl-capability", "recovery-status", "recover", "promote", "health", "rollback"):
            latch = quiescence.recovery_latch()
            if latch and not quiescence.is_active_for(fence):
                if operation not in ("recovery-status", "recover") and (operation != "rollback" or latch.get("fence") != fence):
                    raise broker.BrokerProtocolError("worker release recovery latch blocks this operation")
        if operation in ("recovery-status", "recover"):
            from worker_release_recovery_dispatch import recover, status as recovery_status
            from worker_release_lifecycle import AuthenticatedRun
            identity = AuthenticatedRun.from_broker({
                "repository": repository, "workflow": workflow, "ref": ref,
                "sha": sha, "run_id": run_id, "run_attempt": run_attempt,
                "job_id": job_id, "status": status,
            }, expected_sha=sha)
            current_link = broker.os.path.join(broker.WORKER_ROOT, "current")
            lock_path = broker.os.path.join(broker.WORKER_ROOT, "release.lock")
            state_path = broker.os.path.join(broker.WORKER_ROOT, "release-state.json")
            if operation == "recovery-status":
                return recovery_status(source_sha=sha, quiescence=quiescence, state_path=state_path)
            return recover(
                verified={"sourceSha": sha, "runId": str(run_id), "runAttempt": run_attempt,
                          "jobId": str(job_id), "recoveryOf": recovery_of},
                identity=identity, quiescence=quiescence, current_link=current_link,
                releases_root=releases_root, lock_path=lock_path, state_path=state_path,
            )
        if operation == "preflight":
            count = broker._validate_staged_release(releases_root, sha, worker_gid)
            return {"ok": True, "operation": "preflight", "sourceSha": sha, "entryCount": count}
        if operation == "readiness":
            broker._assert_root_owned_executable("/usr/bin/systemctl")
            broker._assert_root_owned_executable("/usr/bin/crontab")
            try:
                snapshot = broker.collect_worker_readiness(sha)
            except broker.ReadinessRejected as error:
                raise broker.BrokerProtocolError(str(error)) from None
            return {
                "ok": True, "operation": "readiness", "sourceSha": sha,
                "installedSha": snapshot["installedSha"], "ready": snapshot["ready"],
                "units": snapshot["units"], "runId": str(run_id),
                "runAttempt": run_attempt, "jobId": str(job_id),
            }
        if operation == "gigl-capability":
            from worker_release_lifecycle import LifecycleRejected, release_lock

            current_link = broker.os.path.join(broker.WORKER_ROOT, "current")
            lock_path = broker.os.path.join(broker.WORKER_ROOT, "release.lock")
            state_path = broker.os.path.join(broker.WORKER_ROOT, "release-state.json")
            try:
                with release_lock(lock_path):
                    installed_sha = broker._read_current_sha(current_link, releases_root)
                    if installed_sha is None:
                        raise LifecycleRejected("installed worker release is unavailable")
                    try:
                        installed_sha = broker._validate_gigl_release_sha(installed_sha, sha)
                    except broker.BrokerProtocolError as error:
                        raise LifecycleRejected(str(error)) from None
                    state = broker._load_release_state(state_path)
                    if state is None or state.get("status") != "healthy" or state.get("sha") != installed_sha:
                        raise LifecycleRejected("installed worker release is not healthy")
                    tracking_lock_fd = broker._acquire_gigl_tracking_lock(broker.WORKER_ROOT)
                    try:
                        smoke = broker._run_gigl_capability_smoke(
                            broker.WORKER_ROOT, worker_uid, worker_gid, installed_sha
                        )
                        broker._write_gigl_capability_latch(
                            broker.WORKER_ROOT, smoke["scope"], installed_sha,
                            smoke["credentialFingerprint"],
                        )
                    finally:
                        broker.fcntl.flock(tracking_lock_fd, broker.fcntl.LOCK_UN)
                        broker.os.close(tracking_lock_fd)
                    return {
                        "ok": True, "operation": "gigl-capability", "sourceSha": sha,
                        "smokePassed": True, "latched": True, "scope": smoke["scope"],
                        "installedSha": installed_sha, "latchedSha": installed_sha,
                        "runId": str(run_id), "runAttempt": run_attempt,
                        "jobId": str(job_id),
                    }
            except LifecycleRejected as error:
                raise broker.BrokerProtocolError(str(error)) from None
        if operation in ("promote", "health", "rollback"):
            from worker_release_lifecycle import (
                AuthenticatedRun, LifecycleRejected, check_release_health,
                promote_release, release_lock, rollback_release,
            )

            identity = AuthenticatedRun.from_broker({
                "repository": repository, "workflow": workflow, "ref": ref,
                "sha": sha, "run_id": run_id, "run_attempt": run_attempt,
                "job_id": job_id, "status": status,
            }, expected_sha=sha)
            current_link = broker.os.path.join(broker.WORKER_ROOT, "current")
            lock_path = broker.os.path.join(broker.WORKER_ROOT, "release.lock")
            state_path = broker.os.path.join(broker.WORKER_ROOT, "release-state.json")
            try:
                with release_lock(lock_path):
                    def health_check(target_sha: str) -> bool:
                        broker._assert_root_owned_executable(broker.TRUSTED_HEALTH_CHECK)
                        result = broker.subprocess.run(
                            [broker.TRUSTED_HEALTH_CHECK, target_sha],
                            stdin=broker.subprocess.DEVNULL, stdout=broker.subprocess.DEVNULL,
                            stderr=broker.subprocess.DEVNULL, check=False, close_fds=True,
                            cwd="/", env={"PATH": "/usr/bin:/bin", "HOME": "/root"}, timeout=30,
                        )
                        return result.returncode == 0

                    if operation == "promote":
                        broker._validate_staged_release(releases_root, sha, worker_gid)
                        state = broker._load_release_state(state_path)
                        if state is not None and state.get("status") not in ("healthy", "rolled_back"):
                            raise LifecycleRejected("unresolved release state blocks promotion")
                        prior = broker._read_current_sha(current_link, releases_root)
                        lease = quiescence.acquire(identity.fence(), previous_sha=prior)
                        broker._write_release_state(state_path, {
                            "version": 1, "status": "promoting", "sha": sha,
                            "previous_sha": prior, "fence": identity.fence(),
                        })
                        try:
                            with lease.operation():
                                outcome = promote_release(
                                    current_link=current_link, releases_root=releases_root,
                                    identity=identity, health_check=health_check,
                                    quiescence_lease=lease,
                                )
                        except Exception as error:
                            broker._record_promotion_failure(
                                state_path, sha, prior, identity.fence(),
                                restored=broker._promotion_restore_confirmed(error),
                            )
                            raise
                        broker._record_promotion_success(state_path, sha, prior, identity.fence())
                        return {"ok": True, "operation": operation, "sourceSha": sha,
                                "previousSha": prior, "runId": str(run_id), "runAttempt": run_attempt,
                                "jobId": str(job_id)}
                    state = broker._load_release_state(state_path)
                    existing_latch = quiescence.recovery_latch()
                    latch_recovery = bool(existing_latch and existing_latch.get("fence") == identity.fence())
                    if (state is None and not (operation == "rollback" and latch_recovery)) or (
                        state is not None and (state.get("fence") != identity.fence() or state.get("sha") != sha)
                    ):
                        raise LifecycleRejected("release state does not match authenticated run and SHA")
                    if operation == "health":
                        if state is None or state.get("status") != "promoted":
                            raise LifecycleRejected("release state is not ready for health verification")
                        lease = quiescence.require_active(identity.fence())
                        with lease.operation():
                            try:
                                result = _health_after_restart(lease, lambda: check_release_health(
                                        current_link=current_link, releases_root=releases_root,
                                        identity=identity, health_check=health_check,
                                    ))
                                state["status"] = "healthy"
                                broker._write_release_state(state_path, state)
                                lease.confirm_healthy()
                            except Exception:
                                if lease._state == "active" and quiescence.is_active_for(identity.fence()):
                                    lease.abort_health()
                                raise
                        return {"ok": True, "operation": operation, "sourceSha": sha,
                                "healthy": True, "runId": str(run_id), "runAttempt": run_attempt,
                                "jobId": str(job_id)}
                    latch = quiescence.recovery_latch()
                    recovery = bool(latch and latch.get("fence") == identity.fence())
                    if state is not None and state.get("fence") != identity.fence():
                        raise LifecycleRejected("release recovery belongs to another authenticated run")
                    prior = state.get("previous_sha") if state is not None else None
                    if prior is None and recovery:
                        prior = latch.get("previous_sha")
                    if not isinstance(prior, str) or not broker.re.fullmatch(r"[0-9a-f]{40}", prior):
                        raise LifecycleRejected("recorded prior release is invalid")
                    if state is not None and state.get("status") not in ("promoting", "promoted", "healthy", "recovery_required", "rolled_back"):
                        raise LifecycleRejected("release state is not eligible for rollback")
                    lease = quiescence.acquire(identity.fence(), previous_sha=prior, recovery=recovery)
                    current_sha = broker._read_current_sha(current_link, releases_root)
                    with lease.operation():
                        if current_sha == sha:
                            result = rollback_release(
                                current_link=current_link, releases_root=releases_root,
                                identity=identity, promoted_sha=sha, previous_sha=prior,
                                quiescence_lease=lease,
                            )
                        elif current_sha == prior:
                            result = {"ok": True, "sha": prior}
                        else:
                            raise LifecycleRejected("active release does not match the recovery record")
                    broker._record_promotion_failure(state_path, sha, prior, identity.fence(), restored=True)
                    with lease.operation():
                        lease.confirm_rollback()
                    return {"ok": True, "operation": operation, "sourceSha": result["sha"],
                            "rolledBackSha": sha, "runId": str(run_id), "runAttempt": run_attempt,
                            "jobId": str(job_id)}
            except LifecycleRejected as error:
                raise broker.BrokerProtocolError(str(error)) from None
        try:
            encoded = verified["archiveBase64"]
            archive_digest = verified["archiveSha256"]
        except KeyError:
            raise broker.BrokerProtocolError("trusted dispatcher omitted staged archive") from None
        if not isinstance(encoded, str) or not broker.re.fullmatch(r"[0-9a-f]{64}", str(archive_digest)):
            raise broker.BrokerProtocolError("trusted dispatcher returned invalid archive identity")
        archive = broker.base64.b64decode(encoded, validate=True)
        if len(archive) > broker.MAX_ARCHIVE_COMPRESSED_BYTES or broker.hashlib.sha256(archive).hexdigest() != archive_digest:
            raise broker.BrokerProtocolError("trusted dispatcher archive digest mismatch")
        count = _stage_archive(archive, releases_root, sha, worker_uid, worker_gid)
        return {"ok": True, "operation": "stage", "sourceSha": sha, "entryCount": count}

    return dispatch
