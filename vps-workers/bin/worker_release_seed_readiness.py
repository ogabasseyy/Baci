"""Fail-closed per-SHA seed presence check used by builder provisioning."""
from __future__ import annotations

import json
import os
import stat
from pathlib import Path

from worker_release_dependency_policy_cache import EXPECTED_PNPM
from worker_release_dependency_seed_consumer import SEED_MANIFEST, SEED_ROOT, SEED_SHA_RE
from worker_release_seed_workspace_mount import verify_bounded_seed_workspace


class SeedReadinessRejected(RuntimeError):
    """A fixed seed or its bounded storage contract is unavailable or unsafe."""


def seed_ready(source_sha: str | None, *, seed_root: Path = SEED_ROOT,
               owner_uid: int = 0) -> None:
    """Check one immutable seed only after proving its fixed bounded mount."""
    if not isinstance(source_sha, str) or SEED_SHA_RE.fullmatch(source_sha) is None:
        raise SeedReadinessRejected("exact source SHA is required for seed readiness")
    try:
        verify_bounded_seed_workspace()
    except RuntimeError as error:
        raise SeedReadinessRejected("fixed bounded seed workspace is unavailable") from error

    root_fd = -1
    try:
        trusted_path_ancestry(seed_root)
        root_fd = os.open(seed_root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        root_info = os.fstat(root_fd)
        path_info = seed_root.lstat()
        if ((root_info.st_dev, root_info.st_ino) != (path_info.st_dev, path_info.st_ino)
                or not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != owner_uid
                or root_info.st_mode & 0o022):
            raise SeedReadinessRejected("per-SHA seed root is unsafe")
        seed_info = os.stat(source_sha, dir_fd=root_fd, follow_symlinks=False)
        if (not stat.S_ISDIR(seed_info.st_mode) or seed_info.st_uid != owner_uid
                or seed_info.st_mode & 0o222):
            raise SeedReadinessRejected("requested per-SHA seed entry is unsafe")
        seed_fd = os.open(source_sha, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=root_fd)
        try:
            opened_seed = os.fstat(seed_fd)
            if (seed_info.st_dev, seed_info.st_ino) != (opened_seed.st_dev, opened_seed.st_ino):
                raise SeedReadinessRejected("requested per-SHA seed entry changed")
            fd = os.open(SEED_MANIFEST, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=seed_fd)
            try:
                before = os.fstat(fd)
                raw = os.read(fd, 32_769)
                after = os.fstat(fd)
            finally:
                os.close(fd)
        finally:
            os.close(seed_fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner_uid
                or before.st_nlink != 1 or before.st_mode & 0o222
                or before.st_size > 32_768 or len(raw) != before.st_size
                or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                    before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size,
                                             after.st_mtime_ns, after.st_ctime_ns)):
            raise SeedReadinessRejected("per-SHA seed manifest is unsafe")
        manifest = json.loads(raw.decode("utf-8"))
        receipt = manifest.get("verificationReceipt") if isinstance(manifest, dict) else None
        if (not isinstance(manifest, dict) or set(manifest) != {
                "schema", "authenticatedSourceSha", "pnpmVersion", "lockfiles", "policyFiles",
                "metadataCacheSha256", "packageStoreSha256", "sourceTreeSha256",
                "verificationReceipt",
            } or manifest.get("schema") != 1
                or manifest.get("authenticatedSourceSha") != source_sha
                or manifest.get("pnpmVersion") != EXPECTED_PNPM
                or not isinstance(receipt, dict) or receipt.get("sourceSha") != source_sha
                or receipt.get("pnpmVersion") != EXPECTED_PNPM):
            raise SeedReadinessRejected("requested per-SHA seed identity does not match")
        root_after = seed_root.lstat()
        if (root_after.st_dev, root_after.st_ino) != (root_info.st_dev, root_info.st_ino):
            raise SeedReadinessRejected("per-SHA seed root path changed")
    except SeedReadinessRejected:
        raise
    except (OSError, KeyError, ValueError, TypeError) as error:
        raise SeedReadinessRejected("requested per-SHA dependency seed is unavailable") from error
    finally:
        if root_fd >= 0:
            os.close(root_fd)


def trusted_path_ancestry(path: Path) -> None:
    current = Path(path.absolute())
    while True:
        try:
            info = current.lstat()
        except OSError as error:
            raise SeedReadinessRejected("dependency seed path ancestry is unavailable") from error
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise SeedReadinessRejected("dependency seed path ancestry is not root-owned and private")
        if current == current.parent:
            return
        current = current.parent
