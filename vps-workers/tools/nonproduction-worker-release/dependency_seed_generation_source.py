"""Binding of seed generation to staging's descriptor-pinned source view."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from dependency_seed_generation_contract import SeedGenerationRejected
from dependency_seed_source import source_snapshot_digest


def digest_pinned_stage_source(source_path: Path, source_pin: object) -> str:
    """Hash the exact immutable view held by staging, with path rechecks."""
    from worker_release_source_view_access import fixed_reader_uids

    if (getattr(source_pin, "path", None) != source_path
            or getattr(source_pin, "owner_uid", None) != 0
            or getattr(source_pin, "read_uids", None) != fixed_reader_uids()
            or not callable(getattr(source_pin, "verify_unchanged", None))):
        raise SeedGenerationRejected("stage source snapshot pin is required")
    try:
        source_pin.verify_unchanged()
        source_fd = os.open(source_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(source_fd)
            if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o550:
                raise SeedGenerationRejected("stage source view owner or mode is unsafe")
            digest = source_snapshot_digest(source_fd)
        finally:
            os.close(source_fd)
        source_pin.verify_unchanged()
    except SeedGenerationRejected:
        raise
    except Exception as error:
        raise SeedGenerationRejected("stage source view could not be pinned") from error
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise SeedGenerationRejected("stage source view digest is invalid")
    return digest


__all__ = ["digest_pinned_stage_source"]
