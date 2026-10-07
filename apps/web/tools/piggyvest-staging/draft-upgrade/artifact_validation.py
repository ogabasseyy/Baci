import hashlib
import json
import os
import stat
from pathlib import Path, PurePosixPath


class Refused(RuntimeError):
    pass


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def regular_bytes(path: Path) -> bytes:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
    except OSError as error:
        raise Refused('Manifest must be a regular non-symlink file.') from error
    with os.fdopen(descriptor, 'rb') as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode):
            raise Refused('Manifest must be a regular file.')
        return source.read()


def read_manifest(path: Path, expected_hash: str) -> list[dict[str, str]]:
    if (not isinstance(expected_hash, str) or len(expected_hash) != 64
            or any(character not in '0123456789abcdef' for character in expected_hash)):
        raise Refused('Manifest hash must be a lowercase SHA-256 digest.')
    contents = regular_bytes(path)
    if sha256_bytes(contents) != expected_hash:
        raise Refused('Pinned manifest verification failed.')
    try:
        payload = json.loads(contents)
    except (TypeError, ValueError) as error:
        raise Refused('Manifest is not valid JSON.') from error
    if not isinstance(payload, dict) or payload.get('version') != 1 or not isinstance(payload.get('entries'), list):
        raise Refused('Manifest format is invalid.')
    entries = payload['entries']
    if not all(isinstance(entry, dict) and isinstance(entry.get('path'), str)
               and entry.get('type') in ('file', 'symlink') for entry in entries):
        raise Refused('Manifest entries are invalid.')
    if entries != sorted(entries, key=lambda entry: entry['path']) or len({entry['path'] for entry in entries}) != len(entries):
        raise Refused('Manifest entries must be sorted and unique.')
    for entry in entries:
        relative = PurePosixPath(entry['path'])
        if relative.is_absolute() or '..' in relative.parts or any(part.startswith('.env') for part in relative.parts):
            raise Refused('Manifest contains an unsafe path.')
        if entry['type'] == 'file' and (set(entry) != {'path', 'type', 'sha256'}
                                        or not isinstance(entry['sha256'], str)
                                        or len(entry['sha256']) != 64):
            raise Refused('Manifest file entry is invalid.')
        if entry['type'] == 'symlink' and (set(entry) != {'path', 'type', 'target'}
                                           or not isinstance(entry['target'], str)
                                           or not entry['target']):
            raise Refused('Manifest symlink entry is invalid.')
    return entries


def assert_ancestor_directories(root: Path, path: Path) -> None:
    current = root
    for part in path.relative_to(root).parts[:-1]:
        current /= part
        if current.is_symlink() or not current.is_dir():
            raise Refused('Artifact symlink ancestor refused.')


def safe_link(root: Path, path: Path) -> str:
    target = os.readlink(path)
    if os.path.isabs(target):
        raise Refused('Absolute artifact symlink refused.')
    try:
        resolved = (path.parent / target).resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, RuntimeError, ValueError) as error:
        raise Refused('Dangling, cyclic, or escaping artifact symlink refused.') from error
    return target


def artifact_entries(root: Path) -> list[dict[str, str]]:
    if root.is_symlink() or not root.is_dir() or (root / 'apps/web/node_modules').exists():
        raise Refused('Unexpected standalone layout.')
    server = root / 'apps/web/server.js'
    asset_directories = tuple(root / required_path for required_path in ('node_modules', 'apps/web/.next/static', 'apps/web/public'))
    if server.is_symlink() or not server.is_file() or any(path.is_symlink() or not path.is_dir() for path in asset_directories):
        raise Refused('Incomplete standalone build or required assets.')
    entries: list[dict[str, str]] = []
    for path in sorted(root.rglob('*'), key=lambda entry: entry.relative_to(root).as_posix()):
        assert_ancestor_directories(root, path)
        relative = path.relative_to(root).as_posix()
        if any(part.startswith('.env') for part in PurePosixPath(relative).parts):
            raise Refused('Environment files are not allowed in the artifact.')
        if path.is_symlink():
            entries.append({'path': relative, 'type': 'symlink', 'target': safe_link(root, path)})
        elif path.is_file():
            entries.append({'path': relative, 'type': 'file', 'sha256': sha256_file(path)})
        elif not path.is_dir():
            raise Refused('Unsupported artifact entry.')
    return entries
