"""Validate a policy receipt against immutable source and metadata inputs."""
from __future__ import annotations

import hmac
import json
import os
import stat
from pathlib import Path
from typing import Callable

from worker_release_dependency_artifacts import BuilderRejected


def validate_receipt(
    source: Path,
    cache: Path,
    receipt_path: Path,
    pnpm_version: str,
    *,
    make_receipt: Callable[..., dict[str, object]],
    owner_uid: int | None,
    expected_sha: str | None,
    cache_max_bytes: int,
    cache_owner_uid: int | None,
) -> dict[str, object]:
    owner = os.geteuid() if owner_uid is None else owner_uid
    try:
        fd = os.open(receipt_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != owner
                or before.st_mode & 0o022 or before.st_size > 32_768):
            raise BuilderRejected("pnpm policy verification receipt is unsafe")
        raw = os.read(fd, 32_769)
        after = os.fstat(fd)
        if (len(raw) > 32_768 or len(raw) != before.st_size
                or (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns)):
            raise BuilderRejected("pnpm policy verification receipt changed while reading")
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise BuilderRejected("pnpm policy verification receipt is unavailable or malformed") from exc
    finally:
        if "fd" in locals():
            os.close(fd)
    cache_owner = owner if cache_owner_uid is None else cache_owner_uid
    expected = make_receipt(source, cache, pnpm_version, cache_owner=cache_owner,
                            cache_max_bytes=cache_max_bytes)
    if value != expected:
        if isinstance(value, dict) and value.get("metadataCacheSha256") != expected["metadataCacheSha256"]:
            raise BuilderRejected("pnpm policy verification receipt metadata cache changed")
        raise BuilderRejected("pnpm policy verification receipt does not match exact lockfiles and policy")
    if expected_sha is not None and not hmac.compare_digest(str(value["sourceSha"]), expected_sha):
        raise BuilderRejected("pnpm policy verification receipt does not match expected source SHA")
    return value
