"""Policy receipt adapter for the disconnected descriptor-pinned seed prototype."""
from __future__ import annotations

import os
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_lock_settings import lock_injection_settings
from worker_release_dependency_policy_cache import (
    EXPECTED_PNPM,
    POLICY_FILES,
    POLICY_FLAGS,
    TRUSTED_REGISTRY,
    _input_hashes,
    _source_sha,
)
from worker_release_dependency_registry_policy import validate_registry_routing
from dependency_seed_tree import policy_cache_digest_fd


def make_receipt(source: Path, cache: Path | int, pnpm_version: str, *,
                 cache_max_bytes: int) -> dict[str, object]:
    """Build the same consistency receipt over a source path and pinned cache FD."""
    validate_registry_routing(source, POLICY_FILES, TRUSTED_REGISTRY)
    locks, policies = _input_hashes(source)
    if pnpm_version != EXPECTED_PNPM:
        raise BuilderRejected("pnpm version is not pinned")
    owns_fd = not isinstance(cache, int)
    cache_fd = os.open(cache, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
                       | getattr(os, "O_NOFOLLOW", 0)) if owns_fd else cache
    try:
        cache_hash = policy_cache_digest_fd(cache_fd, max_bytes=cache_max_bytes)
    finally:
        if owns_fd:
            os.close(cache_fd)
    return {
        "schema": 1,
        "sourceSha": _source_sha(source),
        "pnpmVersion": EXPECTED_PNPM,
        "lockfiles": locks,
        "policyFiles": policies,
        "effectiveFlags": POLICY_FLAGS,
        "lockInjectionSettings": lock_injection_settings(source),
        "registryRouting": {"default": TRUSTED_REGISTRY, "scoped": "none"},
        "metadataCacheSha256": cache_hash,
        "verification": "pnpm-online-frozen-install-passed",
    }
