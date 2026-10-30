"""Fail-closed archive-owned dependency routing checks for the fixture."""
from __future__ import annotations

import os
import stat
from pathlib import Path

from worker_release_dependency_artifacts import BuilderRejected

SAFE_NPMRC_SETTINGS = {"legacy-peer-deps", "engine-strict"}
MAX_POLICY_FILE_BYTES = 256 * 1024


def _read_stable_regular_file(path: Path, *, max_bytes: int) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise BuilderRejected("dependency configuration file is unavailable") from exc
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > max_bytes:
            raise BuilderRejected("dependency configuration file is unsafe or oversized")
        chunks = []
        total = 0
        while chunk := os.read(fd, min(16_384, max_bytes + 1 - total)):
            total += len(chunk)
            if total > max_bytes:
                raise BuilderRejected("dependency configuration file exceeds its size limit")
            chunks.append(chunk)
        after = os.fstat(fd)
        if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                or total != before.st_size):
            raise BuilderRejected("dependency configuration changed while reading")
        return b"".join(chunks)
    finally:
        os.close(fd)


def validate_registry_routing(source: Path, policy_files: tuple[str, ...], trusted_registry: str) -> None:
    """Reject archive-owned routing; callers pin the registry in env and CLI."""
    for current, directories, files in os.walk(source, topdown=True, followlinks=False):
        directories[:] = [name for name in directories if name != "node_modules"]
        if ".npmrc" in directories:
            raise BuilderRejected("source contains an unsafe npm configuration path")
        if ".npmrc" in files:
            path = Path(current) / ".npmrc"
            try:
                contents = _read_stable_regular_file(path, max_bytes=16_384).decode("utf-8")
            except (OSError, UnicodeError) as exc:
                raise BuilderRejected("source npm configuration cannot be safely checked") from exc
            seen: set[str] = set()
            for line in contents.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith(("#", ";")):
                    continue
                key, separator, value = stripped.partition("=")
                key = key.strip().lower()
                if (not separator or key not in SAFE_NPMRC_SETTINGS or key in seen
                        or value.strip().lower() not in {"true", "false"}):
                    raise BuilderRejected("source .npmrc setting is not in the fixed safe allowlist")
                seen.add(key)
    for relative in policy_files:
        path = source / relative
        try:
            contents = _read_stable_regular_file(path, max_bytes=MAX_POLICY_FILE_BYTES).decode("utf-8")
        except (OSError, UnicodeError) as exc:
            raise BuilderRejected("dependency registry policy cannot be read") from exc
        # Reject any mention instead of guessing YAML syntax. This catches
        # nested, quoted, flow, block, multiline, and escaped routing keys.
        if "registry" in contents.lower() or "\\" in contents:
            raise BuilderRejected("source workspace registry routing or ambiguous YAML is forbidden")
