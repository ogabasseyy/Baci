import fcntl
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess

from notification_contract import Refused, digest


CLOSURE = {'notification_owner.py', 'notification_contract.py', 'notification_database.py',
           'notification_io.py', 'notification_runtime.py', 'notification-state-query.sql',
           'notification-role-guard.sql', 'notification-renewal.sql'}
ENVIRONMENT = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}


def trusted_parents(path):
    for parent in path.parents:
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Refused('file-parent')


def read_file(path, mode, limit=2000000):
    path = Path(path)
    trusted_parents(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_gid != 0
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != mode):
            raise Refused('file-metadata')
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
        stable = lambda metadata: (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid,
                                   metadata.st_gid, metadata.st_nlink, metadata.st_size,
                                   metadata.st_mtime_ns, metadata.st_ctime_ns)
        if (stable(before) != stable(after) or stable(path.lstat()) != stable(after) or not 0 < len(content) <= limit):
            raise Refused('file-read-race')
        return content


def write_new(path, content, mode=0o600):
    trusted_parents(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
        os.fchmod(handle.fileno(), mode)
    sync_directory(path.parent)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def replace_file(path, expected, replacement):
    path = Path(path)
    if read_file(path, 0o444) != expected:
        raise Refused('unit-replacement-drift')
    temporary = path.with_name('.' + path.name + '.' + secrets.token_hex(12))
    write_new(temporary, replacement, 0o444)
    if read_file(path, 0o444) != expected:
        raise Refused('unit-replacement-race')
    os.replace(temporary, path)
    sync_directory(path.parent)
    if read_file(path, 0o444) != replacement:
        raise Refused('unit-replacement-postcondition')


def verify_bundle(directory, expected_digest):
    if directory.parent != Path('/root') or stat.S_IMODE(directory.lstat().st_mode) != 0o700:
        raise Refused('root-private-bundle')
    content = read_file(directory / 'SHA256SUMS', 0o600)
    if re.fullmatch('[0-9a-f]{64}', expected_digest) is None or digest(content) != expected_digest:
        raise Refused('source-seal')
    entries = {}
    for line in content.decode('ascii').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([a-z_-]+\.(?:py|sql))', line)
        if not match or match[2] in entries:
            raise Refused('source-manifest')
        entries[match[2]] = match[1]
    if set(entries) != CLOSURE:
        raise Refused('source-closure')
    for name, pin in entries.items():
        if digest(read_file(directory / name, 0o600)) != pin:
            raise Refused('source-pin')


def operation_lock():
    path = Path('/run/baci-notifications-renewal.lock')
    trusted_parents(path)
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    metadata = os.fstat(descriptor)
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0
            or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600):
        os.close(descriptor)
        raise Refused('lock-metadata')
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(descriptor)
        raise Refused('concurrent-owner') from None
    return descriptor


def run(arguments, input_text=None):
    try:
        result = subprocess.run(arguments, input=input_text, stdin=None if input_text is not None else subprocess.DEVNULL,
                                text=True, capture_output=True, timeout=95, env=ENVIRONMENT)
    except (OSError, subprocess.TimeoutExpired):
        raise Refused('command-unconfirmed') from None
    if result.returncode or len(result.stdout) > 131072 or len(result.stderr) > 131072:
        raise Refused('command-failed')
    return result.stdout
