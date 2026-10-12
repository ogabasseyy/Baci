import os
from pathlib import Path
import stat
from treasury_owner_contract import Refused


def private_directory(path, owner=0):
    metadata = Path(path).lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise Refused('Private directory metadata refused')


def root_ancestors(path):
    for parent in reversed(Path(path).parents):
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Refused('Root-owned ancestors required')


def read_file(path, owner, mode, limit):
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(descriptor)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) != mode or not 0 < before.st_size <= limit):
            raise Refused('Input file metadata refused')
        with os.fdopen(descriptor, 'rb') as handle:
            descriptor = None
            content = handle.read(limit + 1)
            after = os.fstat(handle.fileno())
        if (len(content) != before.st_size or len(content) > limit
                or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)):
            raise Refused('Input file changed during read')
        return content
    except OSError:
        raise Refused('Input file unavailable') from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def write_private(path, content):
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except OSError:
        raise Refused('Existing private output retained') from None
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    directory = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
