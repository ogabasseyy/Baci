"""Bounded readiness probes for disposable systemd integration tests."""
from __future__ import annotations

import subprocess
import time

from worker_release_descriptor_cgroup import CgroupProofRejected


class SystemdStartupRejected(RuntimeError):
    """The disposable manager did not become responsive within its test budget."""


def wait_for_systemd(query, preflight, *, timeout=30, poll=0.25, starting_grace=5,
                     clock=time.monotonic, sleep=time.sleep):
    """Require manager API and cgroup readiness; let real unit tests prove starting managers."""
    deadline = clock() + timeout
    last_state, last_reason = "unavailable", "manager-unreachable"
    starting_since = None
    while (remaining := deadline - clock()) > 0:
        try:
            state_status, state = query("state", min(5.0, remaining))
            version_status, version = query("version", min(5.0, remaining))
            if state in ("starting", "initializing", "running", "degraded", "maintenance",
                         "offline", "stopping"):
                last_state = state
            else:
                last_state = "unexpected"
            if version_status != 0 or not version:
                last_reason = "manager-not-reachable"
            else:
                preflight()
                expected_status = {"running": 0, "degraded": 1}.get(state)
                if expected_status is not None and state_status == expected_status:
                    return state, version
                if state in ("starting", "initializing"):
                    starting_since = clock() if starting_since is None else starting_since
                    if clock() - starting_since >= starting_grace:
                        return state, version
                else:
                    starting_since = None
                last_reason = "manager-starting" if state in ("starting", "initializing") else "manager-not-ready"
        except (OSError, subprocess.SubprocessError, CgroupProofRejected, RuntimeError):
            last_reason = "manager-or-cgroup-preflight-unavailable"
        remaining = deadline - clock()
        if remaining > 0:
            sleep(min(poll, remaining))
    raise SystemdStartupRejected(
        f"systemd did not become responsive within {timeout}s "
        f"(state={last_state}, reason={last_reason})"
    )
