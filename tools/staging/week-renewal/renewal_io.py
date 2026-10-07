import os
from pathlib import Path
import stat

from renewal_contract import Refused, digest


def identity(info):
    return tuple(getattr(info, name) for name in (
        'st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
        'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def trusted_parents(path, owner=0):
    for parent in reversed(Path(path).parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
            raise Refused('untrusted-parent')


def private_directory(path, owner=0):
    info = Path(path).lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_gid != owner
            or stat.S_IMODE(info.st_mode) != 0o700):
        raise Refused('private-directory-metadata')


def read_verified(path, modes, groups, expected=None, owner=0, limit=2000000):
    path = Path(path)
    trusted_parents(path, owner)
    before_path = path.lstat()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (identity(before) != identity(before_path) or not stat.S_ISREG(before.st_mode)
                or before.st_uid != owner or before.st_gid not in groups or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) not in modes or not 0 < before.st_size <= limit):
            raise Refused('source-metadata')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    if (len(content) != before.st_size or identity(before) != identity(after)
            or identity(after) != identity(path.lstat())):
        raise Refused('source-changed')
    if expected is not None and digest(content) != expected:
        raise Refused('source-pin')
    return content, before


def unchanged(path, previous):
    if identity(Path(path).lstat()) != identity(previous):
        raise Refused('source-changed-before-backup')


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_private(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    sync_directory(Path(path).parent)


def publish_preparation(directory, originals, prepared, receipt, owner=0):
    directory = Path(directory)
    private_directory(directory, owner)
    final = directory / 'lane-a-preparation'
    pending = directory / 'lane-a-preparation.pending'
    if final.exists() or final.is_symlink() or pending.exists() or pending.is_symlink():
        raise Refused('existing-preparation-retained')
    pending.mkdir(mode=0o700)
    for name, values in (('original', originals), ('candidate', prepared)):
        child = pending / name
        child.mkdir(mode=0o700)
        for filename, content in values.items():
            if Path(filename).name != filename or filename in ('.', '..'):
                raise Refused('preparation-name')
            write_private(child / filename, content)
    write_private(pending / 'receipt.json', receipt)
    sync_directory(pending)
    if final.exists() or final.is_symlink():
        raise Refused('existing-preparation-retained')
    pending.rename(final)
    sync_directory(directory)
    return final
