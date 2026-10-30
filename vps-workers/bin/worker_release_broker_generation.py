"""Immutable, content-addressed broker generations and atomic current pointer."""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from worker_release_broker_generation_fs import (
    BrokerGenerationRejected, _open_directory, _safe_parts,
)

GENERATION_ROOT = Path("/usr/local/lib/baci-worker-broker")
MAX_FILES = 512
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_TOTAL_BYTES = 96 * 1024 * 1024

@dataclass(frozen=True)
class GenerationFile:
    path: str
    content: bytes
    mode: int
    gid: int

def _canonical_files(files: Iterable[GenerationFile]) -> tuple[list[GenerationFile], list[dict[str, object]]]:
    materialized = tuple(files)
    if not materialized or len(materialized) > MAX_FILES:
        raise BrokerGenerationRejected("generation file set is outside fixed bounds")
    seen: set[str] = set()
    total = 0
    manifest = []
    for item in sorted(materialized, key=lambda value: value.path):
        _safe_parts(item.path)
        if item.path in seen or not isinstance(item.content, bytes):
            raise BrokerGenerationRejected("generation file set contains duplicate or invalid data")
        seen.add(item.path)
        if (type(item.mode) is not int or item.mode not in (0o440, 0o550, 0o640, 0o750)
                or type(item.gid) is not int or item.gid < 0
                or len(item.content) > MAX_FILE_BYTES):
            raise BrokerGenerationRejected("generation file metadata exceeds fixed policy")
        total += len(item.content)
        if total > MAX_TOTAL_BYTES:
            raise BrokerGenerationRejected("broker generation exceeds fixed size limit")
        manifest.append({"path": item.path, "mode": item.mode, "gid": item.gid,
                         "size": len(item.content),
                         "sha256": hashlib.sha256(item.content).hexdigest()})
    return list(sorted(materialized, key=lambda value: value.path)), manifest

def generation_digest(manifest: list[dict[str, object]]) -> str:
    payload = json.dumps({"version": 1, "files": manifest}, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

def current_generation(root: Path, *, owner_uid: int = 0, root_gid: int = 0,
                       state_root: Path | None = None, state_mode: int = 0o700) -> str | None:
    pointer_root = root if state_root is None else state_root
    root_fd = _open_directory(pointer_root, uid=owner_uid, gid=root_gid,
                              mode=0o755 if state_root is None else state_mode)
    try:
        try:
            link_info = os.stat("current", dir_fd=root_fd, follow_symlinks=False)
            target = os.readlink("current", dir_fd=root_fd)
        except FileNotFoundError:
            return None
        if not stat.S_ISLNK(link_info.st_mode) or link_info.st_uid != owner_uid:
            raise BrokerGenerationRejected("current generation entry is not an owned symlink")
        prefix = "generations/" if state_root is None else str(root / "generations") + "/"
        if not target.startswith(prefix) or len(target) != len(prefix) + 64:
            raise BrokerGenerationRejected("current generation link is not canonical")
        digest = target[len(prefix):]
        verify_generation(root, digest, owner_uid=owner_uid, root_gid=root_gid)
        return digest
    finally:
        os.close(root_fd)

def switch_generation(root: Path, digest: str, *, expected_current: str | None,
                      owner_uid: int = 0, root_gid: int = 0,
                      state_root: Path | None = None, state_mode: int = 0o700) -> None:
    verify_generation(root, digest, owner_uid=owner_uid, root_gid=root_gid)
    pointer_root = root if state_root is None else state_root
    root_fd = _open_directory(pointer_root, uid=owner_uid, gid=root_gid,
                              mode=0o755 if state_root is None else state_mode)
    try:
        old = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                 state_root=state_root, state_mode=state_mode)
        if old != expected_current:
            raise BrokerGenerationRejected("current generation changed during switch")
        temporary = f".current.{secrets.token_hex(16)}"
        target = f"generations/{digest}" if state_root is None else str(root / "generations" / digest)
        os.symlink(target, temporary, dir_fd=root_fd)
        os.fsync(root_fd)
        try:
            os.rename(temporary, "current", src_dir_fd=root_fd, dst_dir_fd=root_fd)
            os.fsync(root_fd)
        except BaseException:
            try:
                os.unlink(temporary, dir_fd=root_fd)
            except FileNotFoundError:
                pass
            raise
    finally:
        os.close(root_fd)


def clear_generation_pointer(root: Path, *, expected_current: str,
                             owner_uid: int = 0, root_gid: int = 0,
                             state_root: Path | None = None,
                             state_mode: int = 0o700) -> None:
    """Atomically remove only the exact currently selected generation link."""
    if not isinstance(expected_current, str) or len(expected_current) != 64:
        raise BrokerGenerationRejected("expected current generation is invalid")
    pointer_root = root if state_root is None else state_root
    root_fd = _open_directory(pointer_root, uid=owner_uid, gid=root_gid,
                              mode=0o755 if state_root is None else state_mode)
    try:
        current = current_generation(root, owner_uid=owner_uid, root_gid=root_gid,
                                     state_root=state_root, state_mode=state_mode)
        if current != expected_current:
            raise BrokerGenerationRejected("current generation changed before pointer clear")
        metadata = os.stat("current", dir_fd=root_fd, follow_symlinks=False)
        if not stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != owner_uid:
            raise BrokerGenerationRejected("current generation entry is not an owned symlink")
        os.unlink("current", dir_fd=root_fd)
        os.fsync(root_fd)
    finally:
        os.close(root_fd)

from worker_release_broker_generation_storage import publish_generation, verify_generation

__all__ = ["BrokerGenerationRejected", "GenerationFile", "current_generation",
           "clear_generation_pointer", "generation_digest", "publish_generation",
           "switch_generation", "verify_generation"]
