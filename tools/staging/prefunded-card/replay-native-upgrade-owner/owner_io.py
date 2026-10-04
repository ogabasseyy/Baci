import hashlib
import json
import os
from pathlib import Path
import stat


class Refused(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refused(code)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def decode(content):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    try:
        return json.loads(content.decode('utf8'), object_pairs_hook=unique)
    except (ValueError, UnicodeError):
        raise Refused('json_refused') from None


def directory(filename, uid=0):
    info = Path(filename).lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == uid
            and not info.st_mode & 0o022, 'directory_metadata_refused')


def ancestors(filename):
    for parent in reversed(Path(filename).parents):
        directory(parent)


def read(filename, expected=None, modes=(0o600,), limit=16_000_000, uid=0):
    filename = Path(filename)
    before = filename.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == uid
            and before.st_nlink == 1
            and stat.S_IMODE(before.st_mode) in modes and 0 < before.st_size <= limit,
            'file_metadata_refused')
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as handle:
        opened = os.fstat(handle.fileno())
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns, before.st_nlink)
            == (opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns, opened.st_nlink)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns, after.st_nlink)
            and len(content) == before.st_size, 'file_changed_during_read')
    require(expected is None or digest(content) == expected, 'file_pin_mismatch')
    return content


def write(filename, content, mode=0o600, group=0):
    descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fchown(handle.fileno(), 0, group)
        os.fchmod(handle.fileno(), mode)
        os.fsync(handle.fileno())


def serialized(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
