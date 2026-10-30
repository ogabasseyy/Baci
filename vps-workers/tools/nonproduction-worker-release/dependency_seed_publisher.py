#!/usr/bin/env python3
"""Disconnected immutable per-SHA pnpm seed publisher prototype.

The caller must supply an authenticated SHA and genuine preverification
receipt. This code authenticates neither and is not wired to production.
"""
from __future__ import annotations

import json
import os
import secrets
from contextlib import ExitStack
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_policy_cache import EXPECTED_PNPM, MAX_CACHE_BYTES
from dependency_seed_filesystem import (
    assert_frozen_tree,
    anchored_path,
    child_directory,
    copy_tree,
    freeze_tree,
    open_directory,
    remove_tree,
)
from dependency_seed_publication import rename_noreplace
from dependency_seed_capacity import (
    MAX_SEED_ROOT_BYTES,
    MAX_SEED_ROOT_ENTRIES,
    check_copy_capacity,
    preflight_copy_budget,
    seed_root_usage as _seed_root_usage,
)
from dependency_seed_receipts import make_receipt
from dependency_seed_source import source_snapshot_digest
from dependency_seed_tree import (
    assert_staging_tree,
    measure_frozen_tree,
    policy_cache_digest_fd,
    tree_digest_fd,
)
from dependency_seed_transaction import (
    JOURNAL as INFLIGHT_JOURNAL,
    SHA_RE,
    clear_inflight_journal as _clear_inflight_journal,
    create_inflight_journal as _create_inflight_journal,
    existing_seed_lock as _existing_seed_lock,
    named_root_matches as _named_root_matches,
    reject_unresolved_staging as _reject_unresolved_staging,
    seed_lock as _seed_lock,
    update_inflight_journal as _update_inflight_journal,
)
from dependency_seed_recovery import (
    MAX_STAGE_BYTES,
    MAX_STAGE_ENTRIES,
    recover_interrupted_seed as _recover_interrupted_seed,
)
from dependency_seed_verification import verify_seed_locked
from dependency_seed_generation_contract import (
    _generation_capability_values, validate_generation_attestation,
)

MANIFEST = "seed-manifest.json"
MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024
MAX_TREE_ENTRIES = 200_000


def _own_fd(stack: ExitStack, fd: int) -> int:
    stack.callback(os.close, fd)
    return fd


def _write_manifest(directory_fd: int, value: dict[str, object]) -> None:
    fd = os.open(MANIFEST, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                 | getattr(os, "O_NOFOLLOW", 0), 0o600, dir_fd=directory_fd)
    try:
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise BuilderRejected("seed manifest short write")
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def _publish_seed(source: Path, cache: Path, store: Path, seed_root: Path,
                  authenticated_source_sha: str, *, generation_capability: object,
                  pnpm_version: str = EXPECTED_PNPM,
                  max_cache_bytes: int = MAX_CACHE_BYTES,
                  max_store_bytes: int = MAX_STORE_BYTES) -> Path:
    """Publish once per trusted-caller SHA with descriptor-relative no-replace."""
    if not SHA_RE.fullmatch(authenticated_source_sha):
        raise BuilderRejected("authenticated source SHA is malformed")
    verified_receipt, generation_attestation, prepublish_guard = (
        _generation_capability_values(generation_capability))
    with ExitStack() as stack:
        source_fd = _own_fd(stack, open_directory(Path(source), owner_uid=0, immutable=True))
        cache_fd = _own_fd(stack, open_directory(Path(cache), owner_uid=os.geteuid()))
        store_fd = _own_fd(stack, open_directory(Path(store), owner_uid=os.geteuid()))
        source_path = anchored_path(source_fd)
        source_hash = source_snapshot_digest(source_fd)
        if pnpm_version != EXPECTED_PNPM:
            raise BuilderRejected("pnpm version is not pinned")
        expected_receipt = make_receipt(source_path, cache_fd, pnpm_version,
                                        cache_max_bytes=max_cache_bytes)
        if verified_receipt != expected_receipt:
            raise BuilderRejected("trusted preverification receipt does not match source and cache")
        if expected_receipt["sourceSha"] != authenticated_source_sha:
            raise BuilderRejected("source marker does not match caller-authenticated SHA")
        generation_attestation = validate_generation_attestation(
            generation_attestation, source_sha=authenticated_source_sha,
            source_tree_sha256=source_hash, policy_receipt=expected_receipt,
        )
        cache_hash = policy_cache_digest_fd(cache_fd, max_bytes=max_cache_bytes)
        store_hash = tree_digest_fd(store_fd, max_bytes=max_store_bytes)

        root_fd, lock_fd = _seed_lock(Path(seed_root))
        stack.callback(os.close, root_fd)
        stack.callback(os.close, lock_fd)
        if not _named_root_matches(Path(seed_root), root_fd):
            raise BuilderRejected("seed root path changed after descriptor pinning")
        if INFLIGHT_JOURNAL in os.listdir(root_fd):
            if _recover_interrupted_seed(
                    root_fd, lock_fd, source_fd, authenticated_source_sha,
                    max_cache_bytes=max_cache_bytes, max_store_bytes=max_store_bytes):
                prepublish_guard()
                return Path(seed_root) / authenticated_source_sha
        _reject_unresolved_staging(root_fd)
        try:
            existing = os.stat(authenticated_source_sha, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            existing = None
        if existing is not None:
            # Same-SHA generation is idempotent only when the published tree
            # still verifies against the exact frozen source and policy. Never
            # replace or trust an existing name based on presence alone.
            verify_seed_locked(root_fd, source_fd, authenticated_source_sha,
                               max_cache_bytes=max_cache_bytes,
                               max_store_bytes=max_store_bytes)
            if not _named_root_matches(Path(seed_root), root_fd):
                raise BuilderRejected("seed root path changed while reusing verified seed")
            prepublish_guard()
            return Path(seed_root) / authenticated_source_sha

        copy_budget = preflight_copy_budget(
            root_fd, cache_fd, store_fd, max_cache_bytes=max_cache_bytes,
            max_store_bytes=max_store_bytes, max_root_bytes=MAX_SEED_ROOT_BYTES,
            max_root_entries=MAX_SEED_ROOT_ENTRIES,
        )
        staging_name = f".{authenticated_source_sha}.{secrets.token_hex(16)}"
        journal_fd = _own_fd(stack, _create_inflight_journal(
            root_fd, authenticated_source_sha, staging_name))
        published = False
        staging_fd = -1
        try:
            os.mkdir(staging_name, 0o700, dir_fd=root_fd)
            staging_fd = child_directory(root_fd, staging_name, owner_uid=os.geteuid())
            _update_inflight_journal(root_fd, journal_fd, staging_fd)
            copied_cache_fd = copy_tree(cache_fd, staging_fd, "cache", max_bytes=max_cache_bytes,
                                        max_entries=100_000, aggregate_budget=copy_budget,
                                        capacity_check=lambda byte_count, inode_count: check_copy_capacity(
                                            root_fd, next_bytes=byte_count, next_inodes=inode_count))
            copied_store_fd = -1
            try:
                copied_store_fd = copy_tree(store_fd, staging_fd, "store", max_bytes=max_store_bytes,
                                            max_entries=MAX_TREE_ENTRIES, aggregate_budget=copy_budget,
                                            capacity_check=lambda byte_count, inode_count: check_copy_capacity(
                                                root_fd, next_bytes=byte_count, next_inodes=inode_count))
                if (policy_cache_digest_fd(copied_cache_fd, max_bytes=max_cache_bytes) != cache_hash
                        or tree_digest_fd(copied_store_fd, max_bytes=max_store_bytes) != store_hash):
                    raise BuilderRejected("seed inputs changed while copying")
            finally:
                os.close(copied_cache_fd)
                if copied_store_fd >= 0:
                    os.close(copied_store_fd)
            _write_manifest(staging_fd, {
                "schema": 2,
                "authenticatedSourceSha": authenticated_source_sha,
                "pnpmVersion": pnpm_version,
                "lockfiles": verified_receipt["lockfiles"],
                "policyFiles": verified_receipt["policyFiles"],
                "metadataCacheSha256": cache_hash,
                "packageStoreSha256": store_hash,
                "sourceTreeSha256": source_hash,
                "verificationReceipt": verified_receipt,
                "generationAttestation": generation_attestation,
            })
            freeze_tree(staging_fd)
            assert_frozen_tree(staging_fd, owner_uid=os.geteuid())
            frozen_cache_fd = child_directory(staging_fd, "cache", owner_uid=os.geteuid(), immutable=True)
            frozen_store_fd = child_directory(staging_fd, "store", owner_uid=os.geteuid(), immutable=True)
            try:
                if (policy_cache_digest_fd(frozen_cache_fd, max_bytes=max_cache_bytes) != cache_hash
                        or tree_digest_fd(frozen_store_fd, max_bytes=max_store_bytes) != store_hash):
                    raise BuilderRejected("frozen seed changed before publication")
                current_entries, current_bytes = _seed_root_usage(
                    root_fd, max_root_bytes=MAX_SEED_ROOT_BYTES,
                    max_root_entries=MAX_SEED_ROOT_ENTRIES,
                    exclude_names=frozenset({staging_name}))
                staged_entries, staged_bytes = measure_frozen_tree(
                    staging_fd, owner_uid=os.geteuid(),
                    max_entries=MAX_SEED_ROOT_ENTRIES - current_entries,
                    max_bytes=MAX_SEED_ROOT_BYTES - current_bytes,
                )
                if (current_entries + staged_entries + 1 > MAX_SEED_ROOT_ENTRIES
                        or current_bytes + staged_bytes > MAX_SEED_ROOT_BYTES):
                    raise BuilderRejected("seed root exceeds aggregate quota")
                if not _named_root_matches(Path(seed_root), root_fd):
                    raise BuilderRejected("seed root path changed before publication")
                if source_snapshot_digest(source_fd) != source_hash:
                    raise BuilderRejected("source tree changed before seed publication")
                revalidated_receipt = make_receipt(source_path, frozen_cache_fd,
                                                   pnpm_version, cache_max_bytes=max_cache_bytes)
            finally:
                os.close(frozen_cache_fd)
                os.close(frozen_store_fd)
            if (revalidated_receipt != expected_receipt
                    or revalidated_receipt["sourceSha"] != authenticated_source_sha):
                raise BuilderRejected("source policy changed before seed publication")
            if not callable(prepublish_guard):
                raise BuilderRejected("trusted prepublication fence guard is required")
            prepublish_guard()
            rename_noreplace(root_fd, staging_name, authenticated_source_sha)
            published = True
            os.fsync(root_fd)
            if not _named_root_matches(Path(seed_root), root_fd):
                raise BuilderRejected("seed root path changed during publication")
            if source_snapshot_digest(source_fd) != source_hash:
                raise BuilderRejected("source tree changed during seed publication")
            verify_seed_locked(root_fd, source_fd, authenticated_source_sha,
                               max_cache_bytes=max_cache_bytes, max_store_bytes=max_store_bytes)
            _clear_inflight_journal(root_fd, journal_fd)
            return Path(seed_root) / authenticated_source_sha
        finally:
            try:
                if not published:
                    try:
                        named_stage = os.stat(staging_name, dir_fd=root_fd, follow_symlinks=False)
                    except FileNotFoundError:
                        _clear_inflight_journal(root_fd, journal_fd)
                    else:
                        if staging_fd < 0:
                            raise BuilderRejected("staging directory inode is not pinned for cleanup")
                        staging_info = os.fstat(staging_fd)
                        if (named_stage.st_dev, named_stage.st_ino) != (
                                staging_info.st_dev, staging_info.st_ino):
                            raise BuilderRejected("staging directory inode is not pinned for cleanup")
                        assert_staging_tree(staging_fd, owner_uid=os.geteuid(),
                                            max_entries=MAX_STAGE_ENTRIES,
                                            max_bytes=MAX_STAGE_BYTES)
                        remove_tree(root_fd, staging_name,
                                    expected_identity=(staging_info.st_dev, staging_info.st_ino))
                        _clear_inflight_journal(root_fd, journal_fd)
            finally:
                if staging_fd >= 0:
                    os.close(staging_fd)


def verify_seed(seed: Path, source: Path, *, authenticated_source_sha: str,
                max_cache_bytes: int = MAX_CACHE_BYTES,
                max_store_bytes: int = MAX_STORE_BYTES) -> dict[str, object]:
    """Verify frozen seed contents using pinned descriptors and caller SHA."""
    if not SHA_RE.fullmatch(authenticated_source_sha) or seed.name != authenticated_source_sha:
        raise BuilderRejected("seed path does not match authenticated source SHA")
    with ExitStack() as stack:
        source_fd = _own_fd(stack, open_directory(Path(source), owner_uid=0, immutable=True))
        source_snapshot_digest(source_fd)
        root_fd, lock_fd = _existing_seed_lock(seed.parent)
        stack.callback(os.close, root_fd)
        stack.callback(os.close, lock_fd)
        _reject_unresolved_staging(root_fd)
        return verify_seed_locked(root_fd, source_fd, authenticated_source_sha,
                                  max_cache_bytes=max_cache_bytes,
                                  max_store_bytes=max_store_bytes)
