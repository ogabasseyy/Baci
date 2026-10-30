"""Read the pinned pnpm lockfile's injected-workspace setting safely."""
from __future__ import annotations

import os
import re
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected

LOCK_INJECTION_PATHS = {
    "pnpm-lock.yaml": "pnpm-lock.yaml",
    "vps-workers/pnpm-lock.yaml": "vps-workers/pnpm-lock.yaml",
}
MAX_LOCKFILE_BYTES = 64 * 1024 * 1024
_SETTING = re.compile(r"^  injectWorkspacePackages:\s*(true|false)\s*(?:#.*)?$")


def read_injected_workspace_setting(path: Path) -> bool:
    """Return the canonical lock setting, treating its absence as pnpm false.

    The lockfile is a bounded pnpm-generated YAML document. Only the top-level
    `settings` block is inspected; ambiguous or noncanonical occurrences fail
    closed instead of being interpreted as a different YAML structure.
    """
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("dependency lockfile setting is unavailable") from exc
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > MAX_LOCKFILE_BYTES:
            raise BuilderRejected("dependency lockfile setting inode is unsafe")
        chunks = []
        total = 0
        while chunk := os.read(fd, min(1024 * 1024, before.st_size - total + 1)):
            total += len(chunk)
            if total > MAX_LOCKFILE_BYTES:
                raise BuilderRejected("dependency lockfile exceeds its size limit")
            chunks.append(chunk)
        raw = b"".join(chunks)
        after = os.fstat(fd)
        if (len(raw) != before.st_size
                or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
            raise BuilderRejected("dependency lockfile header changed or exceeds its bound")
    finally:
        os.close(fd)
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise BuilderRejected("dependency lockfile header is malformed") from exc

    settings_count = 0
    in_settings = False
    found: bool | None = None
    for line in lines:
        if line == "settings:":
            settings_count += 1
            if settings_count > 1:
                raise BuilderRejected("dependency lockfile has ambiguous settings blocks")
            in_settings = True
            continue
        if line and not line[0].isspace() and not line.startswith("#"):
            in_settings = False
        if "injectWorkspacePackages" not in line:
            continue
        match = _SETTING.fullmatch(line) if in_settings else None
        if not match or found is not None:
            raise BuilderRejected("dependency lockfile has ambiguous injected-workspace setting")
        found = match.group(1) == "true"
    return found if found is not None else False


def lock_injection_settings(source: Path) -> dict[str, bool]:
    return {relative: read_injected_workspace_setting(source / relative)
            for relative in LOCK_INJECTION_PATHS.values()}
