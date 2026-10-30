"""Conservative, lifecycle-locked pruning of canonical worker release trees.

This module is intentionally not wired into broker dispatch yet. Callers must
invoke ``prune_worker_releases`` only after authenticated broker work; the
function itself takes the lifecycle release lock and refuses deletion unless
release state is terminal and agrees with the current pointer. It never scans
or removes incoming/temp/noncanonical paths.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path

from worker_release_lifecycle import LifecycleRejected, release_lock


SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_RELEASE_DIRECTORIES = 4096
MAX_TREE_ENTRIES = 100_000
MAX_DELETIONS_PER_RUN = 8
DEFAULT_MAX_RETAINED = 5
MAX_STATE_BYTES = 16_384
TERMINAL_STATES = frozenset({"healthy", "rolled_back"})


@dataclass(frozen=True)
class RetentionResult:
    """Safe metadata from one bounded pruning pass."""

    deleted: tuple[str, ...]
    retained: tuple[str, ...]
    reason: str


def _read_state(path: Path, *, owner_uid: int) -> dict[str, object] | None:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0))
    except FileNotFoundError:
        return None
    try:
        metadata = os.fstat(fd)
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner_uid or
                stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1):
            raise ValueError("unsafe release state metadata")
        raw = os.read(fd, MAX_STATE_BYTES + 1)
        if len(raw) > MAX_STATE_BYTES:
            raise ValueError("release state too large")
    finally:
        os.close(fd)
    state = json.loads(raw)
    if (not isinstance(state, dict) or state.get("version") != 1 or
            state.get("status") not in {"promoting", "promoted", "healthy", "rollback_required", "recovery_required", "rolled_back"} or
            not isinstance(state.get("fence"), dict) or not SHA_RE.fullmatch(str(state.get("sha", "")))):
        raise ValueError("release state contract invalid")
    previous = state.get("previous_sha")
    if previous is not None and (not isinstance(previous, str) or not SHA_RE.fullmatch(previous)):
        raise ValueError("release state prior SHA invalid")
    return state


def _current_sha(current: Path, releases: Path, *, owner_uid: int) -> str | None:
    try:
        info = current.lstat()
    except FileNotFoundError:
        return None
    if not stat.S_ISLNK(info.st_mode) or info.st_uid != owner_uid:
        raise ValueError("current pointer is not a trusted symlink")
    target = os.readlink(current)
    match = re.fullmatch(r"releases/([0-9a-f]{40})", target)
    if match is None:
        raise ValueError("current pointer target is invalid")
    release = releases / match.group(1)
    release_info = release.lstat()
    if not stat.S_ISDIR(release_info.st_mode) or stat.S_ISLNK(release_info.st_mode):
        raise ValueError("current release target is invalid")
    return match.group(1)


def _validate_release_tree(path: Path, *, owner_uid: int, worker_gid: int) -> None:
    root = path.lstat()
    if (not stat.S_ISDIR(root.st_mode) or stat.S_ISLNK(root.st_mode) or
            (root.st_uid, root.st_gid, stat.S_IMODE(root.st_mode)) != (owner_uid, worker_gid, 0o550)):
        raise ValueError("release tree root metadata is unsafe")
    entries = 0
    for directory, child_dirs, files in os.walk(path, topdown=True, followlinks=False):
        for name in child_dirs:
            info = (Path(directory) / name).lstat()
            if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or
                    (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (owner_uid, worker_gid, 0o550)):
                raise ValueError("release tree contains an unsafe directory")
            entries += 1
        for name in files:
            info = (Path(directory) / name).lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                    (info.st_uid, info.st_gid) != (owner_uid, worker_gid) or
                    stat.S_IMODE(info.st_mode) not in (0o440, 0o550)):
                raise ValueError("release tree contains an unsafe file")
            entries += 1
            if entries > MAX_TREE_ENTRIES:
                raise ValueError("release tree exceeds entry bound")
        if entries > MAX_TREE_ENTRIES:
            raise ValueError("release tree exceeds entry bound")
    if entries == 0:
        raise ValueError("release tree is empty")


def prune_worker_releases(
    worker_root: str | Path,
    *,
    worker_gid: int,
    request_sha: str | None = None,
    max_retained: int = DEFAULT_MAX_RETAINED,
    owner_uid: int = 0,
) -> RetentionResult:
    """Prune only old validated SHA trees under the lifecycle release lock.

    Terminal state is required. The current SHA, state SHA, prior rollback SHA,
    and authenticated request SHA are protected. At most eight old trees are
    removed per invocation. Unknown entries and every ``.incoming`` path are
    ignored; any unknown state or canonical SHA tree disables all deletion.
    """
    if (type(worker_gid) is not int or worker_gid < 0 or type(owner_uid) is not int or owner_uid < 0 or
            type(max_retained) is not int or max_retained < 1 or max_retained > 64 or
            (request_sha is not None and (not isinstance(request_sha, str) or not SHA_RE.fullmatch(request_sha)))):
        return RetentionResult((), (), "invalid_policy_input")

    root = Path(worker_root)
    releases = root / "releases"
    current_link = root / "current"
    state_path = root / "release-state.json"
    lock_path = root / "release.lock"
    try:
        root_info = root.lstat()
        releases_info = releases.lstat()
        if (not stat.S_ISDIR(root_info.st_mode) or stat.S_ISLNK(root_info.st_mode) or
                root_info.st_uid != owner_uid or stat.S_IMODE(root_info.st_mode) & 0o022 or
                not stat.S_ISDIR(releases_info.st_mode) or stat.S_ISLNK(releases_info.st_mode) or
                releases_info.st_uid != owner_uid or stat.S_IMODE(releases_info.st_mode) & 0o022):
            return RetentionResult((), (), "untrusted_release_root")
        with release_lock(lock_path, expected_owner_uid=owner_uid):
            try:
                state = _read_state(state_path, owner_uid=owner_uid)
                current_sha = _current_sha(current_link, releases, owner_uid=owner_uid)
            except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
                return RetentionResult((), (), "untrusted_release_state_or_pointer")
            if state is None or current_sha is None:
                return RetentionResult((), (), "release_state_or_current_missing")
            status = state["status"]
            state_sha = str(state["sha"])
            previous_sha = state.get("previous_sha")
            if status not in TERMINAL_STATES:
                return RetentionResult((), (), "release_state_not_terminal")
            if status == "healthy" and current_sha != state_sha:
                return RetentionResult((), (), "healthy_state_pointer_mismatch")
            if status == "rolled_back" and (not isinstance(previous_sha, str) or current_sha != previous_sha):
                return RetentionResult((), (), "rollback_state_pointer_mismatch")

            protected = {current_sha, state_sha}
            if isinstance(previous_sha, str):
                protected.add(previous_sha)
            if request_sha is not None:
                protected.add(request_sha)

            try:
                canonical: list[tuple[str, Path, int]] = []
                entries = list(os.scandir(releases))
                if len(entries) > MAX_RELEASE_DIRECTORIES:
                    return RetentionResult((), tuple(sorted(protected)), "release_inventory_exceeds_bound")
                for entry in entries:
                    if not SHA_RE.fullmatch(entry.name):
                        continue
                    info = entry.stat(follow_symlinks=False)
                    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != owner_uid:
                        return RetentionResult((), tuple(sorted(protected)), "unsafe_canonical_release_entry")
                    canonical.append((entry.name, Path(entry.path), info.st_mtime_ns))
                available = {sha for sha, _path, _mtime in canonical}
                if not protected.issubset(available):
                    return RetentionResult((), tuple(sorted(protected)), "protected_release_missing")
                for sha in protected:
                    _validate_release_tree(releases / sha, owner_uid=owner_uid, worker_gid=worker_gid)
                # Newest trees are retained as a small recovery cushion. SHA
                # roots are created by the trusted broker, so root mtime orders
                # successful stage publication without trusting archive paths.
                newest = sorted(canonical, key=lambda item: item[2], reverse=True)
                keep = set(protected)
                for sha, _path, _mtime in newest:
                    if len(keep) >= max_retained:
                        break
                    keep.add(sha)
                candidates = [(sha, path) for sha, path, _mtime in sorted(canonical, key=lambda item: item[2]) if sha not in keep]
                if len(candidates) > MAX_DELETIONS_PER_RUN:
                    candidates = candidates[:MAX_DELETIONS_PER_RUN]
                # Validate every victim before the first unlink, so a malformed
                # tree cannot produce partial pruning in this run.
                for _sha, path in candidates:
                    _validate_release_tree(path, owner_uid=owner_uid, worker_gid=worker_gid)
                deleted: list[str] = []
                for sha, path in candidates:
                    shutil.rmtree(path)
                    deleted.append(sha)
                if deleted:
                    directory_fd = os.open(releases, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                retained = tuple(sorted(available - set(deleted)))
                return RetentionResult(tuple(deleted), retained, "pruned" if deleted else "within_retention_bound")
            except (OSError, ValueError):
                return RetentionResult((), tuple(sorted(protected)), "unsafe_release_inventory")
    except (LifecycleRejected, OSError):
        return RetentionResult((), (), "release_lock_unavailable")


__all__ = ["RetentionResult", "prune_worker_releases"]
