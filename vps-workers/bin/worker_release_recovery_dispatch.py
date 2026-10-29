"""Bounded broker operations for authenticated interrupted-release recovery."""
from __future__ import annotations

import re
from typing import Any

import worker_release_broker as broker


def recovery_target(latch: dict[str, Any]) -> dict[str, Any]:
    fence = latch.get("recovered_from") or latch.get("fence")
    job_id = latch.get("recovered_from_job_id") if latch.get("recovered_from") else latch.get("job_id")
    if (not isinstance(fence, dict) or not re.fullmatch(r"[1-9][0-9]{0,19}", str(job_id or ""))
            or not re.fullmatch(r"[1-9][0-9]{0,19}", str(fence.get("run_id", "")))
            or not re.fullmatch(r"[0-9a-f]{40}", str(fence.get("sha", "")))):
        raise broker.BrokerProtocolError("durable recovery lacks an exact coordinator job identity")
    return {"run_id": fence["run_id"], "run_attempt": int(fence["run_attempt"]),
            "sha": latch.get("release_sha", fence["sha"]), "job_id": str(job_id)}


def _state_matches(state: dict[str, Any] | None, target: dict[str, Any]) -> bool:
    fence = state.get("fence") if state else None
    return bool(isinstance(fence, dict) and state.get("sha") == target["sha"]
                and str(fence.get("run_id")) == target["run_id"]
                and fence.get("run_attempt") == target["run_attempt"]
                and fence.get("sha") == target["sha"]
                and str(fence.get("job_id")) == target["job_id"])


def _state_is_owned_by_latch(state: dict[str, Any] | None, latch: dict[str, Any], target: dict[str, Any]) -> bool:
    fence = state.get("fence") if state else None
    owner = latch.get("fence")
    return bool(isinstance(fence, dict) and isinstance(owner, dict) and state.get("sha") == target["sha"]
                and str(fence.get("run_id")) == str(owner.get("run_id"))
                and fence.get("run_attempt") == owner.get("run_attempt")
                and fence.get("sha") == owner.get("sha")
                and str(fence.get("job_id")) == str(latch.get("job_id")))


def _state_is_pre_promotion(state: dict[str, Any] | None, latch: dict[str, Any], target: dict[str, Any]) -> bool:
    """Recognize a crash after latch fsync but before the promoting state write.

    Promotion writes the latch before it writes state, and does not switch the
    pointer until after that state write. Therefore only the exact healthy
    state for the root-recorded prior SHA is a valid pre-promotion journal.
    The recovery pointer helper separately enforces prior-or-candidate.
    """
    fence = state.get("fence") if state else None
    previous_sha = latch.get("previous_sha")
    return bool(isinstance(fence, dict) and isinstance(previous_sha, str)
                and state.get("status") in ("healthy", "rolled_back")
                and state.get("sha") == previous_sha and fence.get("sha") == previous_sha
                and previous_sha != target["sha"])


def status(*, source_sha: str, quiescence, state_path: str) -> dict[str, Any]:
    latch = quiescence.recovery_latch()
    state = broker._load_release_state(state_path)
    if latch is None:
        if state is not None and state.get("status") not in ("healthy", "rolled_back"):
            raise broker.BrokerProtocolError("release state is unresolved without its recovery latch")
        return {"ok": True, "operation": "recovery-status", "sourceSha": source_sha, "pending": False}
    target = recovery_target(latch)
    if (not (_state_matches(state, target) or _state_is_owned_by_latch(state, latch, target)
             or _state_is_pre_promotion(state, latch, target))
            or state.get("previous_sha") != latch.get("previous_sha")):
        # A pre-promotion state belongs to the prior release and naturally has
        # its own previous_sha; its SHA is the new latch's previous_sha.
        prior_state = _state_is_pre_promotion(state, latch, target)
        if not prior_state:
            raise broker.BrokerProtocolError("durable worker recovery state does not match its latch")
    return {
        "ok": True, "operation": "recovery-status", "sourceSha": source_sha,
        "pending": True, "recoveryOf": target,
        "recoveryOwner": {"run_id": latch["fence"]["run_id"],
                          "run_attempt": latch["fence"]["run_attempt"],
                          "sha": latch["fence"]["sha"], "job_id": latch.get("job_id")},
        "previousSha": latch.get("previous_sha"), "phase": latch.get("phase"),
    }


def recover(*, verified: dict[str, Any], identity, quiescence, current_link: str,
            releases_root: str, lock_path: str, state_path: str) -> dict[str, Any]:
    from worker_release_lifecycle import LifecycleRejected, release_lock
    from worker_release_recovery_lifecycle import restore_recorded_prior

    source_sha = verified["sourceSha"]
    current_fence = {"run_id": str(verified["runId"]), "run_attempt": verified["runAttempt"], "sha": source_sha}
    try:
        with release_lock(lock_path):
            latch = quiescence.recovery_latch()
            state = broker._load_release_state(state_path)
            if latch is None:
                raise LifecycleRejected("worker recovery latch is no longer present")
            target = recovery_target(latch)
            recovery_of = verified.get("recoveryOf")
            same_owner = (latch["fence"] == current_fence and latch.get("job_id") == str(verified["jobId"]))
            if same_owner:
                takeover_from = None
            else:
                if recovery_of != target:
                    raise LifecycleRejected("verified terminal attempt does not match the durable recovery owner")
                takeover_from = latch["fence"]
            pre_promotion = _state_is_pre_promotion(state, latch, target)
            if (not (_state_matches(state, target) or _state_is_owned_by_latch(state, latch, target)
                     or pre_promotion)
                    or (not pre_promotion and state.get("previous_sha") != latch.get("previous_sha"))
                    or latch.get("release_sha") != target["sha"]):
                raise LifecycleRejected("release state does not match the durable recovery record")
            if not pre_promotion and state.get("status") not in ("promoting", "promoted", "healthy", "rollback_required", "recovery_required", "rolled_back"):
                raise LifecycleRejected("release state is not eligible for recovery")
            previous_sha = latch.get("previous_sha")
            if not isinstance(previous_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", previous_sha):
                raise LifecycleRejected("recorded prior release is invalid")
            lease = quiescence.acquire(identity.fence(), previous_sha=previous_sha,
                                       recovery=True, takeover_from=takeover_from)
            with lease.operation():
                result = restore_recorded_prior(
                    current_link=current_link, releases_root=releases_root,
                    release_sha=target["sha"], previous_sha=previous_sha,
                    quiescence_lease=lease,
                )
            broker._record_promotion_failure(state_path, target["sha"], previous_sha,
                                              identity.fence(), restored=True)
            with lease.operation():
                lease.confirm_rollback()
            return {
                "ok": True, "operation": "recover", "sourceSha": source_sha,
                "recovered": True, "rolledBackSha": target["sha"],
                "previousSha": result["sha"], "alreadyRestored": result["alreadyRestored"],
                "runId": str(verified["runId"]), "runAttempt": verified["runAttempt"],
                "jobId": str(verified["jobId"]),
            }
    except (LifecycleRejected, broker.BrokerProtocolError) as error:
        raise broker.BrokerProtocolError(str(error)) from None


__all__ = ["recover", "recovery_target", "status"]
