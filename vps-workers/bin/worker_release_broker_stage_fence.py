"""Recheck a captured active GitHub worker fence through the fixed dispatcher."""
from __future__ import annotations

import json
import subprocess
from typing import Callable

from worker_release_lifecycle import AuthenticatedRun


class StageFenceRejected(RuntimeError):
    """The captured stage attempt could not be revalidated exactly."""


def revalidate_active_stage_fence(
    identity: AuthenticatedRun, github_token: str, *, node: str, dispatcher: str,
    peer_uid: int, release_uid: int, worker_uid: int,
    runner: Callable[..., object] = subprocess.run,
) -> AuthenticatedRun:
    """Return only after the fixed Node proof confirms this exact active attempt.

    The token is sent only on stdin to a root-owned fixed dispatcher and is
    never placed in arguments, environment, exceptions, or logs.
    """
    if (not isinstance(identity, AuthenticatedRun) or identity.status != "in_progress"
            or not isinstance(github_token, str) or not github_token
            or len(github_token) > 4096 or peer_uid != release_uid
            or min(peer_uid, release_uid, worker_uid) <= 0
            or release_uid == worker_uid or not node.startswith("/")
            or not dispatcher.startswith("/")):
        raise StageFenceRejected("stage fence revalidation context is invalid")
    fence = {**identity.fence(), "status": identity.status}
    request = {"operation": "internal-stage-fence-check",
               "githubToken": github_token, "fence": fence}
    child_env = {
        "PATH": "/usr/bin:/bin", "HOME": "/root",
        "BACI_BROKER_PEER_UID": str(peer_uid),
        "BACI_BROKER_RELEASE_UID": str(release_uid),
        "BACI_BROKER_WORKER_UID": str(worker_uid),
        "BACI_BROKER_AUTHENTICATED_PEER": "kernel",
        "BACI_BROKER_INTERNAL_FENCE_CHECK": "1",
    }
    try:
        result = runner(
            [node, dispatcher], input=(json.dumps(request, separators=(",", ":")) + "\n").encode(),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False,
            close_fds=True, cwd="/", env=child_env, timeout=135,
        )
    except Exception as error:
        raise StageFenceRejected("stage fence revalidation failed") from error
    stdout = getattr(result, "stdout", b"")
    if getattr(result, "returncode", 1) != 0 or not isinstance(stdout, bytes) or len(stdout) > 2048:
        raise StageFenceRejected("stage fence revalidation failed")
    try:
        response = json.loads(stdout)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise StageFenceRejected("stage fence revalidation response is malformed") from error
    expected = {**fence, "active": True}
    if response != expected:
        raise StageFenceRejected("stage fence response does not match captured identity")
    return identity


__all__ = ["StageFenceRejected", "revalidate_active_stage_fence"]
