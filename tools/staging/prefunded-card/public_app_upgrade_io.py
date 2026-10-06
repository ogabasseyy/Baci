import os
from pathlib import Path
import stat

from treasury_owner_contract import Refused


def metadata(path, mode, group, owner, directory=False):
    value = Path(path).lstat()
    if (not (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            or value.st_uid != owner or value.st_gid != group
            or stat.S_IMODE(value.st_mode) != mode
            or (not directory and value.st_nlink != 1)):
        raise Refused('Public app metadata differs')


def exact(path, expected, mode, group, owner, reader):
    metadata(path, mode, group, owner)
    if expected == b'':
        verify_empty_artifact(path, mode, group, owner)
        return
    if reader(path, mode, len(expected)) != expected:
        raise Refused('Public app bytes differ')


def verify_empty_artifact(path, mode, group, owner):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != owner
                or before.st_gid != group or stat.S_IMODE(before.st_mode) != mode
                or before.st_nlink != 1 or before.st_size != 0):
            raise Refused('Empty public artifact metadata differs')
        content = handle.read(1)
        after = os.fstat(handle.fileno())
        current = Path(path).lstat()
        fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
                  'st_size', 'st_mtime_ns', 'st_ctime_ns')
        if content or any(getattr(before, field) != getattr(observed, field)
                          for observed in (after, current) for field in fields):
            raise Refused('Empty public artifact changed during read')


def expected_directories(files):
    directories = set()
    for name in files:
        directories.update(str(parent) for parent in Path(name).parents if str(parent) != '.')
    return directories


def verify_app(root, files, owner, root_group, reader):
    root = Path(root)
    metadata(root, 0o555, root_group, owner, directory=True)
    expected = set(files)
    directories = expected_directories(files)
    seen = set()
    for parent, names, filenames in os.walk(root, followlinks=False):
        for name in names + filenames:
            path = Path(parent) / name
            relative = str(path.relative_to(root))
            if relative in directories:
                metadata(path, 0o555, root_group, owner, directory=True)
            elif relative in expected:
                exact(path, files[relative], 0o444, root_group, owner, reader)
                seen.add(relative)
            else:
                raise Refused('Unlisted public app entry retained')
    if seen != expected:
        raise Refused('Public app entry missing')


def write_file(path, content, mode, owner, group):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
        os.fchown(handle.fileno(), owner, group)
        os.fchmod(handle.fileno(), mode)


def sync(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
