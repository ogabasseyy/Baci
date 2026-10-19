import hashlib
import json
import os
import secrets
import stat
from pathlib import Path
from typing import Optional


class InstallRefused(RuntimeError):
    pass


def sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def create_service_root(root: Path) -> os.stat_result:
    root.mkdir(mode=0o700)
    root.chmod(0o755)
    return root.stat()


def read_root_file(path: Path, limit: int = 2_000_000) -> bytes:
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise InstallRefused('Untrusted root-owned path')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 or before.st_mode & 0o022:
            raise InstallRefused('Unsafe root-owned file')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    if len(content) > limit or (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise InstallRefused('Root-owned file changed during read')
    return content


def atomic_write(path: Path, content: bytes, metadata: os.stat_result, mode: Optional[int] = None) -> None:
    temporary = path.with_name(f'.{path.name}.{secrets.token_hex(8)}.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            os.fchmod(handle.fileno(), stat.S_IMODE(metadata.st_mode) if mode is None else mode)
            os.fchown(handle.fileno(), metadata.st_uid, metadata.st_gid)
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def load_bundle(root: Path, manifest_digest: str) -> tuple[dict[str, str], dict[str, object], bytes, bytes]:
    if not root.is_absolute() or root.parent != Path('/root'):
        raise InstallRefused('Root-private bundle required')
    manifest_bytes = read_root_file(root / 'bundle.json', 65536)
    if sha256(manifest_bytes) != manifest_digest:
        raise InstallRefused('Bundle manifest hash drift')
    try:
        manifest = json.loads(manifest_bytes)
    except json.JSONDecodeError as error:
        raise InstallRefused('Invalid bundle manifest') from error
    files = manifest.get('files') if isinstance(manifest, dict) else None
    required = {
        'server.cjs', 'config.json', 'database.sql', 'gateway.py',
        'engagement_gateway.py', 'gateway_receipt.py',
        'funding-gateway-transition-activator.py',
        'funding-gateway-transition-activator-shared.py',
        'funding-gateway-transition-activator-package.py',
        'funding-gateway-transition-activator-preflight.py',
        'funding-gateway-transition-activator-install.py',
        'wallet-gateway-transition-installer.py',
        'funding-gateway-transition-candidate.py',
    }
    if set(manifest) != {'version', 'files'} or manifest.get('version') != 1 or not isinstance(files, dict) or set(files) != required:
        raise InstallRefused('Unexpected bundle manifest')
    content: dict[str, bytes] = {}
    for name, digest in files.items():
        if not isinstance(digest, str) or len(digest) != 64 or any(char not in '0123456789abcdef' for char in digest):
            raise InstallRefused('Invalid bundle digest')
        value = read_root_file(root / name)
        if sha256(value) != digest:
            raise InstallRefused('Bundle payload hash drift')
        content[name] = value
    try:
        public = json.loads(content['config.json'])
    except json.JSONDecodeError as error:
        raise InstallRefused('Invalid public configuration') from error
    return files, public, content['server.cjs'], content['database.sql']


def write_secret(destination: Path, value: str) -> None:
    if not value or '\n' in value or '\x00' in value:
        raise InstallRefused('Credential input rejected')
    destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    directory_metadata = destination.parent.stat()
    if directory_metadata.st_uid != 0 or directory_metadata.st_mode & 0o022:
        raise InstallRefused('Credential directory is unsafe')
    if destination.exists() or destination.is_symlink():
        current = read_root_file(destination, 8192).decode('utf-8')
        if current != value:
            raise InstallRefused('Credential destination already differs')
        return
    metadata = destination.parent.stat()
    atomic_write(destination, value.encode(), metadata, 0o600)
