"""Release-lock coordinated pruning for verified, unreferenced seed trees.

Prototype only. The caller must invoke this after release state is terminal;
the function takes the fixed lifecycle lock itself and never deletes anything
when release state, release inventory, or a seed manifest is ambiguous.
"""
from __future__ import annotations

import os
import re
import secrets
import stat
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_lifecycle import LifecycleRejected, ReleaseLockProof, release_lock
from worker_release_retention import _current_sha, _read_state
from dependency_seed_filesystem import open_directory
from dependency_seed_recovery import _verify_preserved_canonical
from dependency_seed_transaction import existing_seed_lock
from dependency_seed_retention_journal import (
    JOURNAL as RETENTION_JOURNAL,
    cleanup_journal_temps,
    create_journal,
    recover_journal,
)
from worker_release_dependency_policy_cache import MAX_CACHE_BYTES

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_SEEDS = 64
MAX_DELETIONS = 8
MAX_STORE_BYTES = 4 * 1024 * 1024 * 1024


@contextmanager
def _release_guard(lock_path: Path, proof: ReleaseLockProof | None) -> Iterator[None]:
    if proof is None:
        with release_lock(lock_path, expected_owner_uid=0):
            yield
        return
    try:
        proof.require_active(lock_path)
    except LifecycleRejected:
        raise
    yield


def prune_unreferenced_seeds(worker_root: Path, seed_root: Path, *,
                             request_sha: str | None = None,
                             release_lock_proof: ReleaseLockProof | None = None) -> tuple[str, ...]:
    """Delete seeds only when neither a retained release nor state references them."""
    if request_sha is not None and (not isinstance(request_sha, str) or not SHA_RE.fullmatch(request_sha)):
        raise BuilderRejected("seed retention request SHA is invalid")
    root = Path(worker_root)
    releases = root / "releases"
    try:
        root_info, releases_info = root.lstat(), releases.lstat()
        if (not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode)
                or root_info.st_uid != 0 or root_info.st_mode & 0o022
                or not stat.S_ISDIR(releases_info.st_mode) or stat.S_ISLNK(releases_info.st_mode)
                or releases_info.st_uid != 0 or releases_info.st_mode & 0o022):
            raise BuilderRejected("seed retention release paths are unsafe")
        with _release_guard(root / "release.lock", release_lock_proof):
            state = _read_state(root / "release-state.json", owner_uid=0)
            current = _current_sha(root / "current", releases, owner_uid=0)
            if state is None or current is None or state.get("status") not in {"healthy", "rolled_back"}:
                raise BuilderRejected("seed retention requires terminal release state")
            state_sha = state.get("sha")
            previous = state.get("previous_sha")
            if (not isinstance(state_sha, str) or not SHA_RE.fullmatch(state_sha)
                    or (previous is not None and (not isinstance(previous, str) or not SHA_RE.fullmatch(previous)))
                    or (state["status"] == "healthy" and current != state_sha)
                    or (state["status"] == "rolled_back" and current != previous)):
                raise BuilderRejected("seed retention release state and pointer disagree")
            release_names = set(_release_sha_inventory(releases))
            # Every canonical release remains a valid recovery/rollback artifact
            # until the separate release-retention policy removes that tree.
            protected = set(release_names) | {current, state_sha}
            if previous is not None:
                protected.add(previous)
            if request_sha is not None:
                protected.add(request_sha)
            if not (protected - ({request_sha} if request_sha is not None else set())).issubset(release_names):
                raise BuilderRejected("seed retention referenced release is missing")

            root_fd, lock_fd = existing_seed_lock(Path(seed_root))
            try:
                cleanup_journal_temps(root_fd)
                if RETENTION_JOURNAL in os.listdir(root_fd):
                    recover_journal(root_fd, lock_fd, referenced_shas=protected)
                entries = os.listdir(root_fd)
                if ".publish-inflight.json" in entries:
                    raise BuilderRejected("seed retention refuses an inflight publication")
                names = [name for name in entries if name != ".publish.lock"]
                if len(names) > MAX_SEEDS or any(not SHA_RE.fullmatch(name) for name in names):
                    raise BuilderRejected("seed retention inventory contains unknown entries")
                candidates = [name for name in names if name not in protected]
                if len(candidates) > MAX_DELETIONS:
                    candidates = candidates[:MAX_DELETIONS]
                victims = []
                for name in candidates:
                    info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
                    _verify_preserved_canonical(root_fd, name, info.st_dev, info.st_ino,
                                                max_cache_bytes=MAX_CACHE_BYTES,
                                                max_store_bytes=MAX_STORE_BYTES)
                    create_journal(root_fd, name, secrets.token_hex(16),
                                   (info.st_dev, info.st_ino))
                    recover_journal(root_fd, lock_fd, referenced_shas=protected)
                    if _maybe_exists(root_fd, name):
                        raise BuilderRejected("seed retention left its canonical source behind")
                    victims.append(name)
                return tuple(victims)
            finally:
                os.close(lock_fd)
                os.close(root_fd)
    except LifecycleRejected as error:
        raise BuilderRejected("seed retention release lock is unavailable") from error


def _release_sha_inventory(releases: Path) -> tuple[str, ...]:
    result = []
    with os.scandir(releases) as entries:
        for entry in entries:
            if not SHA_RE.fullmatch(entry.name):
                # Incoming trees or any unknown entry may be a live transaction.
                raise BuilderRejected("seed retention release inventory is not quiescent")
            info = entry.stat(follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
                raise BuilderRejected("seed retention found an unsafe release entry")
            result.append(entry.name)
            if len(result) > 4096:
                raise BuilderRejected("seed retention release inventory exceeds its bound")
    return tuple(result)


def _maybe_exists(root_fd: int, name: str) -> bool:
    try:
        os.stat(name, dir_fd=root_fd, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False
