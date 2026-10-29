"""Terminal-proof recovery for interrupted disconnected seed publication."""
from __future__ import annotations

import json
import os
import re
import stat

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import assert_frozen_tree, child_directory, remove_tree
from dependency_seed_empty_recovery import remove_empty_unrecorded_stage
from dependency_seed_transaction import (
    clear_inflight_journal,
    publisher_is_terminal,
    read_inflight_journal,
    require_held_seed_lock,
)
from dependency_seed_tree import assert_staging_tree
from dependency_seed_tree import policy_cache_digest_fd, tree_digest_fd
from dependency_seed_verification import verify_seed_locked
from worker_release_dependency_policy_cache import EXPECTED_PNPM

MAX_STAGE_BYTES = 8 * 1024 * 1024 * 1024 + 32_768
MAX_STAGE_ENTRIES = 100_000 + 200_000 + 3


def recover_interrupted_seed(root_fd: int, lock_fd: int, source_fd: int, source_sha: str, *,
                             max_cache_bytes: int, max_store_bytes: int) -> bool:
    """Recover only an exact journaled seed after its publisher is proven terminal.

    Returns true when a complete seed was published before interruption. Hidden
    staging trees are removed only when their recorded inode matches exactly.
    """
    require_held_seed_lock(root_fd, lock_fd)
    value, journal_fd = read_inflight_journal(root_fd)
    try:
        if not publisher_is_terminal(value):
            raise BuilderRejected("inflight seed publisher is still active")
        journal_sha = str(value["sourceSha"])
        stage_name = value["stagingName"]
        stage = _maybe_stat(root_fd, stage_name)
        target = _maybe_stat(root_fd, journal_sha)
        if stage is not None and target is not None:
            raise BuilderRejected("inflight seed has both staging and canonical entries")
        if stage is not None:
            device, inode = value["stagingDevice"], value["stagingInode"]
            if device is None:
                if inode is not None:
                    raise BuilderRejected("inflight staging inode journal is inconsistent")
                remove_empty_unrecorded_stage(root_fd, lock_fd, stage_name)
                clear_inflight_journal(root_fd, journal_fd)
                return False
            if (stage.st_dev, stage.st_ino) != (device, inode):
                raise BuilderRejected("inflight staging inode cannot be authenticated")
            staging_fd = child_directory(root_fd, stage_name, owner_uid=os.geteuid())
            try:
                opened = os.fstat(staging_fd)
                if (opened.st_dev, opened.st_ino) != (device, inode):
                    raise BuilderRejected("inflight staging inode changed")
                assert_staging_tree(staging_fd, owner_uid=os.geteuid(),
                                    max_entries=MAX_STAGE_ENTRIES, max_bytes=MAX_STAGE_BYTES)
            finally:
                os.close(staging_fd)
            remove_tree(root_fd, stage_name, expected_identity=(device, inode))
            clear_inflight_journal(root_fd, journal_fd)
            return False
        if target is not None:
            device, inode = value["stagingDevice"], value["stagingInode"]
            if device is None or (target.st_dev, target.st_ino) != (device, inode):
                raise BuilderRejected("canonical seed inode differs from inflight journal")
            if journal_sha == source_sha:
                verify_seed_locked(root_fd, source_fd, source_sha,
                                   max_cache_bytes=max_cache_bytes,
                                   max_store_bytes=max_store_bytes)
            else:
                _verify_preserved_canonical(root_fd, journal_sha, device, inode,
                                            max_cache_bytes=max_cache_bytes,
                                            max_store_bytes=max_store_bytes)
            clear_inflight_journal(root_fd, journal_fd)
            return journal_sha == source_sha
        clear_inflight_journal(root_fd, journal_fd)
        return False
    finally:
        os.close(journal_fd)


def _maybe_stat(root_fd: int, name: str):
    try:
        info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not (stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()):
        raise BuilderRejected("inflight seed path has unsafe type or ownership")
    return info


def _verify_preserved_canonical(root_fd: int, sha: str, device: int, inode: int, *,
                                max_cache_bytes: int, max_store_bytes: int) -> None:
    """Authenticate, then retain, a cross-SHA canonical tree without its source."""
    seed_fd = child_directory(root_fd, sha, owner_uid=os.geteuid(), immutable=True)
    try:
        opened = os.fstat(seed_fd)
        if (opened.st_dev, opened.st_ino) != (device, inode):
            raise BuilderRejected("canonical seed inode changed during recovery")
        assert_frozen_tree(seed_fd, owner_uid=os.geteuid())
        manifest_fd = os.open("seed-manifest.json", os.O_RDONLY
                              | getattr(os, "O_NOFOLLOW", 0), dir_fd=seed_fd)
        try:
            info = os.fstat(manifest_fd)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_mode & 0o222 or info.st_size > 32_768):
                raise BuilderRejected("published seed manifest is unsafe")
            raw = os.read(manifest_fd, 32_769)
            after = os.fstat(manifest_fd)
            if len(raw) != info.st_size or (info.st_dev, info.st_ino, info.st_mtime_ns,
                                             info.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns):
                raise BuilderRejected("published seed manifest changed during recovery")
        finally:
            os.close(manifest_fd)
        manifest = json.loads(raw)
        expected_keys = {
            "schema", "authenticatedSourceSha", "pnpmVersion", "lockfiles", "policyFiles",
            "metadataCacheSha256", "packageStoreSha256", "sourceTreeSha256", "verificationReceipt",
        }
        if (not isinstance(manifest, dict) or set(manifest) != expected_keys
                or manifest.get("schema") != 1 or manifest.get("authenticatedSourceSha") != sha
                or manifest.get("pnpmVersion") != EXPECTED_PNPM
                or not isinstance(manifest.get("sourceTreeSha256"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", manifest["sourceTreeSha256"])):
            raise BuilderRejected("published seed manifest identity differs from journal")
        receipt = manifest["verificationReceipt"]
        receipt_keys = {
            "schema", "sourceSha", "pnpmVersion", "lockfiles", "policyFiles", "effectiveFlags",
            "lockInjectionSettings", "registryRouting", "metadataCacheSha256", "verification",
        }
        if (not isinstance(receipt, dict) or set(receipt) != receipt_keys
                or receipt.get("schema") != 1 or receipt.get("sourceSha") != sha
                or receipt.get("pnpmVersion") != EXPECTED_PNPM
                or receipt.get("verification") != "pnpm-online-frozen-install-passed"
                or manifest["lockfiles"] != receipt.get("lockfiles")
                or manifest["policyFiles"] != receipt.get("policyFiles")):
            raise BuilderRejected("published seed receipt identity differs from journal")
        cache_fd = child_directory(seed_fd, "cache", owner_uid=os.geteuid(), immutable=True)
        store_fd = child_directory(seed_fd, "store", owner_uid=os.geteuid(), immutable=True)
        try:
            cache_hash = policy_cache_digest_fd(cache_fd, max_bytes=max_cache_bytes)
            store_hash = tree_digest_fd(store_fd, max_bytes=max_store_bytes)
            if (manifest["metadataCacheSha256"] != cache_hash
                    or manifest["packageStoreSha256"] != store_hash
                    or receipt["metadataCacheSha256"] != cache_hash):
                raise BuilderRejected("published seed content digests differ from manifest")
        finally:
            os.close(cache_fd)
            os.close(store_fd)
    finally:
        os.close(seed_fd)
