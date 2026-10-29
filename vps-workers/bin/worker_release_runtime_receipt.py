"""In-process receipt type and validation for pinned runtime smoke results."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from worker_release_candidate_pin import CandidatePinRejected, pin_candidate
from worker_release_lifecycle import AuthenticatedRun
from worker_release_runtime_acl import RuntimeAclRejected, verifier_gid

VERIFIER_VERSION = "materialized-worker-runtime-v2-dedicated-acl"
ACCESS_POLICY = "candidate-posix-acl-readonly-v1"
RECEIPT_SEAL = object()
EXPECTED_CHECKS = ("web_tsx_version", "worker_production_dependency_imports")


@dataclass(frozen=True)
class RuntimeVerificationReceipt:
    """In-process proof token; it is deliberately not serializable or portable."""

    fence: tuple[tuple[str, object], ...]
    archive_sha256: str
    candidate_sha256: str
    candidate_dev: int
    candidate_ino: int
    verifier_version: str
    verifier_gid: int
    access_policy: str
    checks: tuple[str, ...]
    _seal: object


def validate_runtime_receipt(receipt: object, candidate: Path, identity: AuthenticatedRun,
                             archive_sha256: str, *, owner_uid: int = 0,
                             owner_gid: int) -> bool:
    """Accept only a sealed receipt for the exact unchanged candidate and run."""
    if (not isinstance(identity, AuthenticatedRun) or identity.status != "in_progress"
            or not isinstance(identity.sha, str) or len(identity.sha) != 40
            or any(ch not in "0123456789abcdef" for ch in identity.sha)
            or not isinstance(archive_sha256, str) or len(archive_sha256) != 64
            or any(ch not in "0123456789abcdef" for ch in archive_sha256)
            or not isinstance(receipt, RuntimeVerificationReceipt)
            or receipt._seal is not RECEIPT_SEAL
            or receipt.verifier_version != VERIFIER_VERSION
            or type(receipt.verifier_gid) is not int or receipt.verifier_gid <= 0
            or receipt.access_policy != ACCESS_POLICY
            or receipt.checks != EXPECTED_CHECKS
            or receipt.archive_sha256 != archive_sha256
            or receipt.fence != tuple(sorted(identity.fence().items()))):
        return False
    try:
        if verifier_gid() != receipt.verifier_gid:
            return False
        with pin_candidate(candidate, expected_sha=identity.sha, owner_uid=owner_uid,
                           owner_gid=owner_gid, verifier_gid=receipt.verifier_gid) as pin:
            pin.verify_unchanged()
            return (pin.digest == receipt.candidate_sha256
                    and (pin.candidate_identity[0], pin.candidate_identity[1])
                    == (receipt.candidate_dev, receipt.candidate_ino))
    except (OSError, CandidatePinRejected, RuntimeAclRejected):
        return False


__all__ = ["EXPECTED_CHECKS", "RECEIPT_SEAL", "RuntimeVerificationReceipt",
           "ACCESS_POLICY", "VERIFIER_VERSION", "validate_runtime_receipt"]
