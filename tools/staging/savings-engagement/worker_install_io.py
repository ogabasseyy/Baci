import os
from pathlib import Path
import secrets
import stat

from worker_contract import InstallError


def _safe_path(path: Path, root: Path, owner: int) -> None:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
            raise InstallError('Untrusted destination parent')


def read_fixed(path: Path, root: Path, owner: int, mode: int, limit: int = 2_000_000) -> bytes:
    _safe_path(path, root, owner)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        raise
    except OSError as error:
        raise InstallError('Unsafe existing destination') from error

    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != mode
        ):
            raise InstallError('Unsafe existing destination metadata')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
        before_state = (before.st_ino, before.st_size, before.st_mtime_ns)
        after_state = (after.st_ino, after.st_size, after.st_mtime_ns)
        if len(content) > limit or before_state != after_state:
            raise InstallError('Destination changed while reading')
        return content


def write_fixed(path: Path, content: bytes, root: Path, owner: int, mode: int) -> bool:
    _safe_path(path, root, owner)
    try:
        existing = read_fixed(path, root, owner, mode, max(len(content), 1))
    except FileNotFoundError:
        existing = None
    if existing is not None:
        if existing != content:
            raise InstallError('Nonmatching existing destination refused')
        return False

    temporary = path.with_name(f'.{path.name}.{secrets.token_hex(8)}.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            os.fchown(handle.fileno(), owner, -1)
            os.fchmod(handle.fileno(), mode)
        os.link(temporary, path, follow_symlinks=False)
        directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except FileExistsError as error:
        raise InstallError('Concurrent destination creation refused') from error
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
    return True


def ensure_directory(path: Path, root: Path, owner: int, mode: int) -> bool:
    _safe_path(path, root, owner)
    try:
        info = path.lstat()
    except FileNotFoundError:
        path.mkdir(mode=mode)
        info = path.lstat()
        if info.st_uid != owner:
            raise InstallError('Created directory ownership mismatch')
        os.chmod(path, mode)
        return True
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or stat.S_IMODE(info.st_mode) != mode:
        raise InstallError('Unsafe existing directory refused')
    return False
