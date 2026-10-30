"""Validation for broker-supplied dependency source snapshots."""
from __future__ import annotations

import os
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected, SHA_RE

WORKER_ROOT = Path("/srv/baci-workers")


def safe_source(source: Path, expected_sha: str) -> Path:
    if not SHA_RE.fullmatch(expected_sha):
        raise BuilderRejected("expected commit SHA is invalid")
    try:
        source_info = source.lstat()
    except OSError as exc:
        raise BuilderRejected("source root is unavailable") from exc
    if not stat.S_ISDIR(source_info.st_mode):
        raise BuilderRejected("source root must be a real directory")
    source = source.resolve(strict=True)
    if not source.is_dir():
        raise BuilderRejected("source root must be a real directory")
    if source == WORKER_ROOT or WORKER_ROOT in source.parents:
        raise BuilderRejected("source tree must be outside the production worker root")
    # This marker is a consistency check only. It is not proof of OIDC or source
    # provenance; the broker must verify a signed attestation before integration.
    marker = source / ".baci-source-sha"
    try:
        marker_fd = os.open(marker, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("source SHA marker is unavailable or unsafe") from exc
    try:
        marker_info = os.fstat(marker_fd)
        marker_bytes = os.read(marker_fd, 65)
        marker_after = os.fstat(marker_fd)
        if (not stat.S_ISREG(marker_info.st_mode) or marker_info.st_nlink != 1
                or marker_info.st_size > 64 or marker_info.st_size != len(marker_bytes)
                or marker_info.st_mtime_ns != marker_after.st_mtime_ns
                or marker_info.st_ctime_ns != marker_after.st_ctime_ns):
            raise BuilderRejected("source SHA marker is not a stable bounded regular file")
    finally:
        os.close(marker_fd)
    try:
        marker_value = marker_bytes.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise BuilderRejected("source SHA marker is malformed") from exc
    if marker_value != expected_sha:
        raise BuilderRejected("source SHA marker does not match requested release")
    required = (source / "pnpm-lock.yaml", source / "vps-workers" / "pnpm-lock.yaml")
    if any(not item.is_file() or item.is_symlink() for item in required):
        raise BuilderRejected("required frozen lockfiles are missing or unsafe")
    return source
