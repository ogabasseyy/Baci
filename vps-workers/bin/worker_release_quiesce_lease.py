"""Broker-owned, fail-closed quiescence lease façade."""
from __future__ import annotations

import re
from pathlib import Path

_GENERATION_ROOT = Path(__file__).resolve().parent
LEASE_HELPER_PATH = str(_GENERATION_ROOT / "worker-release-quiesce-lease.sh")
LEASE_SUPPORT_PATHS = tuple(str(_GENERATION_ROOT / name) for name in (
    "worker_release_quiesce_locks.py", "worker_release_quiesce_lease_runtime.py",
    "worker_release_recovery_latch.py", "worker_release_quiesce_gate.py",
    "worker_release_quiesce_lease_core.py", "worker_release_quiesce_lease_manager.py",
))
LEASE_MAX_SECONDS = 20 * 60
LEASE_READY_SECONDS = 630
LEASE_LOCK_SECONDS = 590
LEASE_CLEANUP_SECONDS = 35
TRUSTED_ROOT_UID = 0
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[1-9][0-9]{0,19}$")


class QuiesceLeaseRejected(RuntimeError):
    """The fixed quiescence lease could not be safely acquired or released."""


from worker_release_quiesce_lease_identity import identity_key as _identity_key_impl, verify_installed_helper as _verify_installed_helper_impl
from worker_release_quiesce_locks import LockSetError, acquire_production_lock_fds
from worker_release_quiesce_lease_runtime import abandon_start as _abandon_start, await_line as _await_line, await_ready as _await_ready
from worker_release_recovery_latch import LATCH_PATH, LatchError, create_latch, load_latch, update_latch
from worker_release_quiesce_gate import HealthGateServer
from worker_release_quiesce_lease_core import WorkerQuiesceLease
from worker_release_quiesce_lease_manager import WorkerQuiesceLeaseManager


def _identity_key(identity: object) -> tuple[str, int, str]:
    return _identity_key_impl(identity, id_re=ID_RE, sha_re=SHA_RE, rejected=QuiesceLeaseRejected)


def _verify_installed_helper() -> None:
    _verify_installed_helper_impl(LEASE_HELPER_PATH, LEASE_SUPPORT_PATHS,
                                  trusted_uid=TRUSTED_ROOT_UID, rejected=QuiesceLeaseRejected)


__all__ = ["QuiesceLeaseRejected", "WorkerQuiesceLease", "WorkerQuiesceLeaseManager"]
