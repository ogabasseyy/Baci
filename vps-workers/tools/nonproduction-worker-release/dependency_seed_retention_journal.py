"""Durable tombstone journal for interrupted seed-tree pruning."""
from __future__ import annotations

import json
import os
import re
import stat

from worker_release_dependency_artifacts import BuilderRejected
from dependency_seed_filesystem import remove_tree
from dependency_seed_publication import rename_noreplace
from dependency_seed_transaction import require_held_seed_lock
from dependency_seed_tree import assert_staging_tree
from dependency_seed_recovery import _verify_preserved_canonical
from worker_release_retention import _current_sha, _read_state

JOURNAL = ".retention-inflight.json"
TX_RE = re.compile(r"^[0-9a-f]{32}$")
TEMP_RE = re.compile(r"^\.retention-([0-9a-f]{32})\.tmp$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MAX_BYTES = 16 * 1024 * 1024 * 1024
MAX_ENTRIES = 500_000
MAX_JOURNAL_BYTES = 2048


def create_journal(root_fd: int, sha: str, transaction_id: str,
                   identity: tuple[int, int]) -> int:
    if not SHA_RE.fullmatch(sha) or not TX_RE.fullmatch(transaction_id):
        raise BuilderRejected("seed retention journal identity is malformed")
    value = {"schema": 1, "sha": sha, "transaction_id": transaction_id,
             "tombstone": f".prune-{sha}-{transaction_id}",
             "device": identity[0], "inode": identity[1]}
    payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii")
    temporary = f".retention-{transaction_id}.tmp"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=root_fd)
    try:
        view = memoryview(payload)
        while view:
            written = os.write(fd, view)
            if written <= 0:
                raise BuilderRejected("seed retention journal write was incomplete")
            view = view[written:]
        os.fsync(fd)
        info = os.fstat(fd)
    finally:
        os.close(fd)
    temp_named = os.stat(temporary, dir_fd=root_fd, follow_symlinks=False)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600
            or (info.st_dev, info.st_ino) != (temp_named.st_dev, temp_named.st_ino)):
        raise BuilderRejected("seed retention temporary journal inode is unsafe")
    os.link(temporary, JOURNAL, src_dir_fd=root_fd, dst_dir_fd=root_fd,
            follow_symlinks=False)
    os.unlink(temporary, dir_fd=root_fd)
    os.fsync(root_fd)
    return os.open(JOURNAL, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)


def recover_journal(root_fd: int, lock_fd: int, *, referenced_shas: set[str],
                    max_bytes: int = MAX_BYTES, max_entries: int = MAX_ENTRIES) -> bool:
    """Finish an interrupted tombstone or restore it if a release now references it."""
    require_held_seed_lock(root_fd, lock_fd)
    value, journal_fd = _read(root_fd)
    try:
        sha, tombstone = value["sha"], value["tombstone"]
        identity = value["device"], value["inode"]
        canonical = _maybe_stat(root_fd, sha)
        tomb = _maybe_stat(root_fd, tombstone)
        if canonical and tomb:
            raise BuilderRejected("seed retention has both canonical and tombstone paths")
        if canonical:
            if (canonical.st_dev, canonical.st_ino) != identity:
                raise BuilderRejected("seed retention canonical inode differs from journal")
            if sha in referenced_shas:
                _verify_preserved_canonical(root_fd, sha, *identity,
                                            max_cache_bytes=4 * 1024**3,
                                            max_store_bytes=4 * 1024**3)
                _clear(root_fd, journal_fd)
                return True
            _verify_preserved_canonical(root_fd, sha, *identity,
                                        max_cache_bytes=4 * 1024**3,
                                        max_store_bytes=4 * 1024**3)
            rename_noreplace(root_fd, sha, tombstone)
            os.fsync(root_fd)
            tomb = _maybe_stat(root_fd, tombstone)
        if tomb is None:
            _clear(root_fd, journal_fd)
            return False
        if (tomb.st_dev, tomb.st_ino) != identity:
            raise BuilderRejected("seed retention tombstone inode differs from journal")
        if sha in referenced_shas:
            rename_noreplace(root_fd, tombstone, sha)
            try:
                _verify_preserved_canonical(root_fd, sha, *identity,
                                            max_cache_bytes=4 * 1024**3,
                                            max_store_bytes=4 * 1024**3)
            except BaseException:
                rename_noreplace(root_fd, sha, tombstone)
                raise BuilderRejected("referenced seed tombstone cannot be safely restored")
            _clear(root_fd, journal_fd)
            return True
        fd = os.open(tombstone, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            opened = os.fstat(fd)
            if (opened.st_dev, opened.st_ino) != identity:
                raise BuilderRejected("seed retention tombstone changed while opening")
            assert_staging_tree(fd, owner_uid=os.geteuid(),
                                max_entries=max_entries, max_bytes=max_bytes)
        finally:
            os.close(fd)
        remove_tree(root_fd, tombstone, expected_identity=identity)
        os.fsync(root_fd)
        _clear(root_fd, journal_fd)
        return False
    finally:
        os.close(journal_fd)


def _read(root_fd: int) -> tuple[dict[str, object], int]:
    try:
        fd = os.open(JOURNAL, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
    except OSError as error:
        raise BuilderRejected("seed retention journal is unavailable") from error
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_size > MAX_JOURNAL_BYTES):
            raise BuilderRejected("seed retention journal metadata is unsafe")
        raw = os.read(fd, MAX_JOURNAL_BYTES + 1)
        value = json.loads(raw)
        if (not isinstance(value, dict)
                or set(value) != {"schema", "sha", "transaction_id", "tombstone", "device", "inode"}
                or value.get("schema") != 1
                or not isinstance(value.get("sha"), str) or not SHA_RE.fullmatch(value["sha"])
                or not isinstance(value.get("transaction_id"), str) or not TX_RE.fullmatch(value["transaction_id"])
                or value.get("tombstone") != f".prune-{value['sha']}-{value['transaction_id']}"
                or type(value.get("device")) is not int or value["device"] < 0
                or type(value.get("inode")) is not int or value["inode"] < 1):
            raise BuilderRejected("seed retention journal contract is invalid")
        return value, fd
    except BaseException:
        os.close(fd)
        raise


def _maybe_stat(root_fd: int, name: str):
    try:
        info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise BuilderRejected("seed retention path type or owner is unsafe")
    return info


def _clear(root_fd: int, journal_fd: int) -> None:
    pinned = os.fstat(journal_fd)
    named = os.stat(JOURNAL, dir_fd=root_fd, follow_symlinks=False)
    if (pinned.st_dev, pinned.st_ino) != (named.st_dev, named.st_ino):
        raise BuilderRejected("seed retention journal changed before clear")
    os.unlink(JOURNAL, dir_fd=root_fd)
    os.fsync(root_fd)


def cleanup_journal_temps(root_fd: int) -> None:
    """Remove only protocol-owned journal temps; no deletion precedes final link."""
    for name in os.listdir(root_fd):
        match = TEMP_RE.fullmatch(name)
        if match is None:
            continue
        info = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_nlink not in (1, 2) or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_size > MAX_JOURNAL_BYTES):
            raise BuilderRejected("seed retention temporary journal is unsafe")
        try:
            value, fd = _read(root_fd)
        except BuilderRejected:
            value, fd = None, -1
        if fd >= 0:
            try:
                if value["transaction_id"] != match.group(1):
                    raise BuilderRejected("seed retention temporary journal transaction differs")
            finally:
                os.close(fd)
        elif any(entry.startswith(f".prune-") and entry.endswith(f"-{match.group(1)}")
                 for entry in os.listdir(root_fd)):
            raise BuilderRejected("unrecorded seed retention tombstone exists")
        os.unlink(name, dir_fd=root_fd)
        os.fsync(root_fd)


def referenced_release_shas(worker_root, request_sha: str | None = None) -> set[str]:
    """Protect state, pointer, and every canonical retained release SHA."""
    from pathlib import Path

    root = Path(worker_root)
    releases = root / "releases"
    state = _read_state(root / "release-state.json", owner_uid=0)
    current = _current_sha(root / "current", releases, owner_uid=0)
    if state is None or current is None:
        raise BuilderRejected("seed recovery cannot prove current release references")
    state_sha = state.get("sha")
    if not isinstance(state_sha, str) or not SHA_RE.fullmatch(state_sha):
        raise BuilderRejected("seed recovery state SHA is malformed")
    referenced = {current, state_sha}
    previous = state.get("previous_sha")
    if previous is not None:
        if not isinstance(previous, str) or not SHA_RE.fullmatch(previous):
            raise BuilderRejected("seed recovery previous SHA is malformed")
        referenced.add(previous)
    if request_sha is not None:
        if not SHA_RE.fullmatch(request_sha):
            raise BuilderRejected("seed recovery request SHA is malformed")
        referenced.add(request_sha)
    release_names = set()
    with os.scandir(releases) as entries:
        for entry in entries:
            if not SHA_RE.fullmatch(entry.name):
                raise BuilderRejected("seed recovery release inventory is not canonical")
            info = entry.stat(follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0:
                raise BuilderRejected("seed recovery release inventory is unsafe")
            release_names.add(entry.name)
    if not (referenced - ({request_sha} if request_sha is not None else set())).issubset(release_names):
        raise BuilderRejected("seed recovery referenced release is missing")
    return release_names | referenced
