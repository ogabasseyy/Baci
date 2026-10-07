#!/usr/bin/env python3
"""Root-owned path helpers for the funding gateway transition candidate."""

import hashlib
import json
import os
import stat
from pathlib import Path

class Refused(RuntimeError):
    pass


STATE_DIRECTORY = Path('/var/lib/baci-savings-gateway-install')
OWNER_INPUT_PATH = Path('/etc/baci-savings-gateway/funding-transition-inputs.json')
POST_RENEWAL_MANIFEST_PATH = Path('/etc/baci-savings-gateway/post-renewal-install-manifest.json')
PACKAGE_MANIFEST_PATH = Path('/etc/baci-savings-gateway/funding-transition-package-manifest.json')
GATEWAY_UNIT_PATH = Path('/etc/systemd/system/baci-savings-gateway.service')
PROVENANCE_PATH = STATE_DIRECTORY / 'funding-transition-receipt.json'

def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_hash(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        character in '0123456789abcdef' for character in value
    )


def _safe_ancestors(path: Path, owner_uid: int) -> None:
    for ancestor in reversed((path.parent, *path.parent.parents)):
        try:
            metadata = ancestor.lstat()
        except OSError as error:
            raise Refused('Root-managed input path is unavailable.') from error
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_mode & 0o022:
            raise Refused('Root-managed input path is unsafe.')


def _read_root_file(
    path: Path, owner_uid: int = 0, modes: tuple[int, ...] = (0o400, 0o600)
) -> bytes:
    _safe_ancestors(path, owner_uid)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise Refused('Root-managed input is unavailable.') from error
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) not in modes
            or before.st_size > 1_048_576
        ):
            raise Refused('Root-managed input is unsafe.')
        content = handle.read()
        after = os.fstat(handle.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ):
        raise Refused('Root-managed input changed while read.')
    return content


def _json_file(path: Path, owner_uid: int = 0) -> tuple[dict[str, object], bytes]:
    content = _read_root_file(path, owner_uid)
    try:
        value = json.loads(content)
    except (TypeError, ValueError) as error:
        raise Refused('Root-managed input is not valid JSON.') from error
    if not isinstance(value, dict):
        raise Refused('Root-managed input has an invalid shape.')
    return value, content


def _require_keys(value: dict[str, object], keys: set[str]) -> None:
    if set(value) != keys:
        raise Refused('Owner input has an unexpected shape.')


