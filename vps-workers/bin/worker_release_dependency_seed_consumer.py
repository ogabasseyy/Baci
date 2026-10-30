"""Consume only a frozen dependency seed bound to the authenticated source SHA.

Seed generation is deliberately absent here. Online preverification and seed
publication remain separate operations; the build path only verifies and
copies an already published, root-owned per-SHA seed.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, copy_source_tree, make_read_only_input
from worker_release_dependency_input_cache import (
    copy_private_offline_store,
    copy_private_policy_cache,
    validate_offline_store,
)
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES, MAX_CACHE_ENTRIES, RECEIPT_NAME
from dependency_seed_filesystem import child_directory, open_directory
from dependency_seed_source import source_snapshot_digest
from dependency_seed_transaction import named_root_matches, reject_unresolved_staging
from dependency_seed_verification import verify_seed_locked

SEED_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SEED_MANIFEST = "seed-manifest.json"
SEED_ROOT = Path("/var/cache/baci-worker-release/seeds")


def _open_seed_root_lock(seed_root: Path) -> tuple[int, int]:
    root_fd = open_directory(seed_root, owner_uid=0)
    lock_fd = -1
    try:
        lock_fd = os.open(".publish.lock", os.O_RDWR | getattr(os, "O_NOFOLLOW", 0),
                          dir_fd=root_fd)
        info = os.fstat(lock_fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or info.st_mode & 0o077):
            raise BuilderRejected("dependency seed lock inode is unsafe")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BuilderRejected("dependency seed publication is active") from error
        named = os.stat(".publish.lock", dir_fd=root_fd, follow_symlinks=False)
        if (named.st_dev, named.st_ino) != (info.st_dev, info.st_ino):
            raise BuilderRejected("dependency seed lock name changed")
        return root_fd, lock_fd
    except BaseException:
        if lock_fd >= 0:
            os.close(lock_fd)
        os.close(root_fd)
        raise


def _write_receipt(input_root: Path, receipt: object) -> Path:
    if not isinstance(receipt, dict) or len(json.dumps(receipt).encode("utf-8")) > 32_768:
        raise BuilderRejected("dependency seed verification receipt is malformed")
    parent_fd = os.open(input_root, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    fd = -1
    created = False
    try:
        parent = os.fstat(parent_fd)
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022:
            raise BuilderRejected("dependency seed input directory is unsafe")
        fd = os.open(RECEIPT_NAME, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                     | getattr(os, "O_NOFOLLOW", 0), 0o440, dir_fd=parent_fd)
        created = True
        payload = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise BuilderRejected("dependency seed receipt write was incomplete")
            view = view[written:]
        os.fchown(fd, 0, 0)
        os.fchmod(fd, 0o440)
        os.fsync(fd)
    except BaseException:
        if fd >= 0:
            os.close(fd)
            fd = -1
        if created:
            try:
                os.unlink(RECEIPT_NAME, dir_fd=parent_fd)
            except OSError:
                pass
        raise
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(parent_fd)
    return input_root / RECEIPT_NAME


def consume_seed(source: Path, authenticated_source_sha: str, *, seed_root: Path,
                 scratch: Path, input_root: Path, builder_uid: int, builder_gid: int,
                 max_store_bytes: int, max_store_entries: int,
                 max_cache_bytes: int = MAX_CACHE_BYTES,
                 max_cache_entries: int = MAX_CACHE_ENTRIES) -> Path:
    """Verify and copy the SHA-specific cache/store into the private build roots.

    The SHA must come from the authenticated staging caller. Source marker and
    seed manifest are rechecked for consistency but do not authenticate a run.
    """
    if (not isinstance(authenticated_source_sha, str)
            or not SEED_SHA_RE.fullmatch(authenticated_source_sha)
            or builder_uid <= 0 or builder_gid < 0):
        raise BuilderRejected("authenticated dependency seed identity is malformed")
    source_fd = open_directory(Path(source), owner_uid=0, immutable=True)
    root_fd = lock_fd = seed_fd = cache_fd = store_fd = -1
    try:
        source_digest = source_snapshot_digest(source_fd)
        root_fd, lock_fd = _open_seed_root_lock(Path(seed_root))
        if not named_root_matches(Path(seed_root), root_fd):
            raise BuilderRejected("dependency seed root path changed")
        reject_unresolved_staging(root_fd)
        manifest = verify_seed_locked(
            root_fd, source_fd, authenticated_source_sha,
            max_cache_bytes=max_cache_bytes, max_store_bytes=max_store_bytes,
        )
        receipt = manifest.get("verificationReceipt")
        if not isinstance(receipt, dict) or receipt.get("sourceSha") != authenticated_source_sha:
            raise BuilderRejected("dependency seed receipt does not match authenticated source")
        seed_fd = child_directory(root_fd, authenticated_source_sha, owner_uid=0, immutable=True)
        cache_fd = child_directory(seed_fd, "cache", owner_uid=0, immutable=True)
        store_fd = child_directory(seed_fd, "store", owner_uid=0, immutable=True)
        # Keep the child name beneath the held seed descriptor.  A bare
        # /proc/self/fd/N path is itself a symlink, so validators that use
        # lstat correctly reject it as a link.  Addressing the child through
        # the already-pinned parent resolves to the real directory while
        # `expected_root_identity` below still binds each reopen to its fd.
        cache_path = Path(f"/proc/self/fd/{seed_fd}/cache")
        store_path = Path(f"/proc/self/fd/{seed_fd}/store")

        # Independently enforce current production copy limits. This path does
        # not increase capacity when a source-specific seed is larger.
        store_identity, excluded = validate_offline_store(
            store_path, owner_uid=0, max_entries=max_store_entries, max_bytes=max_store_bytes,
        )
        copy_private_offline_store(
            store_path, scratch, builder_uid, builder_gid, store_identity, excluded,
            max_entries=max_store_entries, max_bytes=max_store_bytes,
        )

        cache_seed = input_root / "pnpm-cache-seed"
        cache_identity = os.fstat(cache_fd)
        copy_source_tree(cache_path, cache_seed, max_bytes=max_cache_bytes,
                         max_entries=max_cache_entries,
                         expected_root_identity=(cache_identity.st_dev, cache_identity.st_ino))
        make_read_only_input(cache_seed)
        copy_private_policy_cache(cache_path, scratch, builder_uid, builder_gid,
                                  max_entries=max_cache_entries, max_bytes=max_cache_bytes)
        _write_receipt(input_root, receipt)

        # Hold the seed lock and all source descriptors through the copy, then
        # revalidate the immutable bytes and path binding before returning.
        verified_again = verify_seed_locked(
            root_fd, source_fd, authenticated_source_sha,
            max_cache_bytes=max_cache_bytes, max_store_bytes=max_store_bytes,
        )
        if (verified_again != manifest or source_snapshot_digest(source_fd) != source_digest
                or not named_root_matches(Path(seed_root), root_fd)):
            raise BuilderRejected("dependency seed or source changed during private copy")
        return cache_seed
    finally:
        for fd in (store_fd, cache_fd, seed_fd, lock_fd, root_fd, source_fd):
            if fd >= 0:
                os.close(fd)


__all__ = ["SEED_MANIFEST", "SEED_ROOT", "SEED_SHA_RE", "consume_seed"]
