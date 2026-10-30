"""Synthetic only: build structurally valid seed attestation fixtures."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Callable

from dependency_seed_source import source_snapshot_digest
from dependency_seed_generation_contract import GenerationCapability, _issue_generation_capability


def fixture_generation_attestation(source: Path, sha: str,
                                   policy_receipt: dict[str, object]) -> dict[str, object]:
    source_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        source_digest = source_snapshot_digest(source_fd)
    finally:
        os.close(source_fd)
    return {
        "schema": 1,
        "fence": {
            "repository": "ogabasseyy/Baci",
            "workflow": ".github/workflows/production-release.yml",
            "ref": "refs/heads/main", "sha": sha, "run_id": "1",
            "run_attempt": 1, "job_id": "1", "status": "in_progress",
        },
        "archiveSha256": hashlib.sha256(("fixture-archive:" + sha).encode()).hexdigest(),
        "sourceTreeSha256": source_digest,
        "unit": f"baci-worker-seed-{sha[:12]}-{'0' * 32}.service",
        "unitQuiescence": "systemd-collected-cgroup-and-uid-absence-proved",
        "policyReceipt": policy_receipt,
    }


def fixture_prepublish_guard() -> Callable[[], None]:
    """Explicit no-op fence guard for synthetic-only publisher tests."""
    return lambda: None


def fixture_generation_capability(source: Path, sha: str,
                                  policy_receipt: dict[str, object], *,
                                  prepublish_guard: Callable[[], None] | None = None
                                  ) -> GenerationCapability:
    """Test-only capability factory; no production caller may use this module."""
    return _issue_generation_capability(
        policy_receipt, fixture_generation_attestation(source, sha, policy_receipt),
        prepublish_guard or fixture_prepublish_guard(),
    )
