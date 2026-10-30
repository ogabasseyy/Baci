"""Verification of published immutable seed contents under a held root lock."""
from __future__ import annotations

import json
import os
import stat

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_policy_cache import EXPECTED_PNPM, MAX_CACHE_BYTES
from dependency_seed_filesystem import anchored_path, assert_frozen_tree, child_directory
from dependency_seed_receipts import make_receipt
from dependency_seed_source import source_snapshot_digest
from dependency_seed_tree import policy_cache_digest_fd, tree_digest_fd
from dependency_seed_generation_contract import validate_generation_attestation

MANIFEST = "seed-manifest.json"
MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024


def verify_seed_locked(root_fd: int, source_fd: int, source_sha: str, *,
                       max_cache_bytes: int = MAX_CACHE_BYTES,
                       max_store_bytes: int = MAX_STORE_BYTES) -> dict[str, object]:
    seed_fd = child_directory(root_fd, source_sha, owner_uid=os.geteuid(), immutable=True)
    try:
        assert_frozen_tree(seed_fd, owner_uid=os.geteuid())
        manifest_fd = os.open(MANIFEST, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                              dir_fd=seed_fd)
        try:
            info = os.fstat(manifest_fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_mode & 0o222 or info.st_size > 32_768):
                raise BuilderRejected("seed manifest is unsafe")
            raw = os.read(manifest_fd, 32_769)
            after = os.fstat(manifest_fd)
            if len(raw) != info.st_size or len(raw) > 32_768 or (
                    info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
                raise BuilderRejected("seed manifest changed while reading")
        finally:
            os.close(manifest_fd)
        value = json.loads(raw)
        expected_keys = {
            "schema", "authenticatedSourceSha", "pnpmVersion", "lockfiles", "policyFiles",
            "metadataCacheSha256", "packageStoreSha256", "sourceTreeSha256", "verificationReceipt",
            "generationAttestation",
        }
        if (not isinstance(value, dict) or set(value) != expected_keys or value.get("schema") != 2
                or value.get("authenticatedSourceSha") != source_sha
                or value.get("pnpmVersion") != EXPECTED_PNPM):
            raise BuilderRejected("seed manifest identity does not match")
        cache_fd = child_directory(seed_fd, "cache", owner_uid=os.geteuid(), immutable=True)
        store_fd = child_directory(seed_fd, "store", owner_uid=os.geteuid(), immutable=True)
        try:
            source_path = anchored_path(source_fd)
            receipt = make_receipt(source_path, cache_fd, EXPECTED_PNPM,
                                   cache_max_bytes=max_cache_bytes)
            source_hash = source_snapshot_digest(source_fd)
            if value.get("verificationReceipt") != receipt:
                raise BuilderRejected("seed policy receipt no longer matches exact source and cache")
            validate_generation_attestation(
                value.get("generationAttestation"), source_sha=source_sha,
                source_tree_sha256=source_hash, policy_receipt=receipt,
            )
            if (value.get("sourceTreeSha256") != source_hash
                    or receipt["sourceSha"] != source_sha
                    or value.get("metadataCacheSha256") != policy_cache_digest_fd(
                        cache_fd, max_bytes=max_cache_bytes)
                    or value.get("packageStoreSha256") != tree_digest_fd(
                        store_fd, max_bytes=max_store_bytes)):
                raise BuilderRejected("immutable dependency seed bytes changed")
        finally:
            os.close(cache_fd)
            os.close(store_fd)
        return value
    finally:
        os.close(seed_fd)
