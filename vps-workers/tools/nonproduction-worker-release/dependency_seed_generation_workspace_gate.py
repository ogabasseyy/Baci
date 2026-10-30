"""Validate persistent immutable seeds before allowing another generation."""
from __future__ import annotations

import os
import re
import fcntl
import stat

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_recovery import _verify_preserved_canonical
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES
from dependency_seed_retention_journal import (
    JOURNAL as RETENTION_JOURNAL, cleanup_journal_temps,
    recover_journal, referenced_release_shas,
)

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024


def validate_seed_collection(workspace_fd: int, *, release_lock_proof=None,
                             worker_root=None, request_sha: str | None = None) -> tuple[str, ...]:
    """Accept/create the fixed child and validate its lock and canonical seeds."""
    try:
        os.mkdir("seeds", 0o700, dir_fd=workspace_fd)
        os.fsync(workspace_fd)
    except FileExistsError:
        pass
    try:
        root_fd = os.open("seeds", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=workspace_fd)
    except OSError as error:
        raise SeedGenerationRejected("persistent seed collection is not a directory") from error
    lock_fd = -1
    try:
        root = os.fstat(root_fd)
        if (root.st_uid != os.geteuid() or stat.S_IMODE(root.st_mode) != 0o700):
            raise SeedGenerationRejected("persistent seed collection ownership or mode is unsafe")
        lock_fd = os.open(".publish.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,
                          0o600, dir_fd=root_fd)
        lock = os.fstat(lock_fd)
        named = os.stat(".publish.lock", dir_fd=root_fd, follow_symlinks=False)
        if (not stat.S_ISREG(lock.st_mode) or lock.st_uid != os.geteuid()
                or lock.st_nlink != 1 or stat.S_IMODE(lock.st_mode) != 0o600
                or (lock.st_dev, lock.st_ino) != (named.st_dev, named.st_ino)):
            raise SeedGenerationRejected("persistent seed publisher lock is unsafe")
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise SeedGenerationRejected("seed publisher is active during workspace preflight") from error
        cleanup_journal_temps(root_fd)
        names = os.listdir(root_fd)
        if RETENTION_JOURNAL in names:
            if release_lock_proof is None or worker_root is None:
                raise SeedGenerationRejected("interrupted seed retention requires broker lock proof")
            try:
                from pathlib import Path
                release_lock_proof.require_active(Path(worker_root) / "release.lock")
                recover_journal(
                    root_fd, lock_fd,
                    referenced_shas=referenced_release_shas(worker_root, request_sha),
                )
            except Exception as error:
                raise SeedGenerationRejected("interrupted seed retention recovery failed closed") from error
            names = os.listdir(root_fd)
        if ".publish-inflight.json" in names:
            raise SeedGenerationRejected("interrupted seed publication requires recovery")
        seeds = [name for name in names if name != ".publish.lock"]
        if len(seeds) > 64 or any(not SHA_RE.fullmatch(name) for name in seeds):
            raise SeedGenerationRejected("seed collection contains an unknown or excess entry")
        for name in seeds:
            info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
            _verify_preserved_canonical(root_fd, name, info.st_dev, info.st_ino,
                                        max_cache_bytes=MAX_CACHE_BYTES,
                                        max_store_bytes=MAX_STORE_BYTES)
        return tuple(sorted(seeds))
    except SeedGenerationRejected:
        raise
    except Exception as error:
        raise SeedGenerationRejected("persistent seed collection failed validation") from error
    finally:
        if lock_fd >= 0:
            os.close(lock_fd)
        os.close(root_fd)
