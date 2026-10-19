import os
from pathlib import Path
import stat

from treasury_owner_contract import Refused
from treasury_owner_io import read_file, root_ancestors


OWNER = 0
ROOT_GROUP = 0
GROUP = 65530


def capture(path, limit, modes=(0o600,)):
    root_ancestors(path)
    metadata = Path(path).lstat()
    mode = stat.S_IMODE(metadata.st_mode)
    if mode not in modes or metadata.st_gid != ROOT_GROUP:
        raise Refused('Protected public input metadata refused')
    return read_file(path, OWNER, mode, limit)


def metadata(path, mode, group, directory=False):
    value = path.lstat()
    if (not (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            or value.st_uid != OWNER or value.st_gid != group or stat.S_IMODE(value.st_mode) != mode
            or (not directory and value.st_nlink != 1)):
        raise Refused('Public installation metadata differs')


def matching(path, content, mode, group):
    metadata(path, mode, group)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        metadata(path, mode, group)
        actual = handle.read(len(content) + 1)
        after = os.fstat(handle.fileno())
    if (actual != content or before.st_ino != path.lstat().st_ino
            or (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)):
        raise Refused('Immutable public installation differs')


def place(path, content, mode, group):
    if path.exists() or path.is_symlink():
        matching(path, content, mode, group)
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fchown(handle.fileno(), OWNER, group)
        os.fchmod(handle.fileno(), mode)
        os.fsync(handle.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def directory(path, mode, group):
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o700)
        os.chown(path, OWNER, group, follow_symlinks=False)
        path.chmod(mode)
    metadata(path, mode, group, directory=True)


def prepare_tree(root, files, receipt, verify_only=False):
    expected = {**files, 'receipt.json': receipt}
    directories = {'.': (0o750, GROUP), 'config': (0o710, GROUP), 'units': (0o700, ROOT_GROUP)}
    for name in files:
        if (not name.startswith(('app/', 'config/', 'units/')) or '\\' in name
                or any(part in ('', '.', '..') for part in name.split('/'))):
            raise Refused('Public installation path refused')
        for parent in Path(name).parents:
            directories.setdefault(str(parent), (0o555, ROOT_GROUP))

    def attributes(name):
        return (0o440, GROUP) if name.startswith('config/') else (
            (0o444, ROOT_GROUP) if name.startswith('app/') else (0o600 if name == 'receipt.json' else 0o644, ROOT_GROUP))

    if root.exists() or root.is_symlink():
        metadata(root, 0o750, GROUP, directory=True)
        if not (root / 'receipt.json').exists():
            raise Refused('Foreign public installation retained')
        matching(root / 'receipt.json', receipt, 0o600, ROOT_GROUP)
        for parent, dirs, names in os.walk(root, followlinks=False):
            for child in dirs + names:
                path = Path(parent) / child
                name = str(path.relative_to(root))
                if name in directories:
                    metadata(path, *directories[name], directory=True)
                elif name in expected:
                    matching(path, expected[name], *attributes(name))
                else:
                    raise Refused('Unlisted public installation retained')
    else:
        if verify_only:
            raise Refused('Public installation missing')
        directory(root, 0o750, GROUP)
        place(root / 'receipt.json', receipt, 0o600, ROOT_GROUP)
    for name in sorted(directories, key=lambda item: (len(Path(item).parts), item)):
        if verify_only:
            metadata(root / name, *directories[name], directory=True)
        else:
            directory(root / name, *directories[name])
    for name, content in expected.items():
        (matching if verify_only else place)(root / name, content, *attributes(name))
