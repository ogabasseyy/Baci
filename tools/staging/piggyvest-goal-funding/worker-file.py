import hashlib
import os
from pathlib import Path
import pwd
import secrets
import stat

PARENT = Path('/home/bassey/pvb-staging-replay')


class Refused(RuntimeError):
    pass


def replace_codefile(name, content, old_sha256, new_sha256):
    if (not name or Path(name).name != name or not isinstance(content, bytes)
            or hashlib.sha256(content).hexdigest() != new_sha256):
        raise Refused('Invalid codefile input')
    if PARENT.resolve(strict=True) != PARENT or not stat.S_ISDIR(PARENT.lstat().st_mode):
        raise Refused('Untrusted replay directory')
    owner_uid = pwd.getpwnam('bassey').pw_uid
    if os.geteuid() != owner_uid:
        raise Refused('Must run as the replay-file owner')
    parent_stat = PARENT.lstat()
    if parent_stat.st_uid != owner_uid or stat.S_IMODE(parent_stat.st_mode) != 0o700:
        raise Refused('Untrusted replay directory owner or mode')
    directory = os.open(PARENT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = f'.{name}.{secrets.token_hex(8)}.tmp'
    try:
        current = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(current)
            old = os.read(current, 16_000_001)
            after = os.fstat(current)
            identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
            identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != owner_uid
                    or identity_before != identity_after or len(old) > 16_000_000
                    or hashlib.sha256(old).hexdigest() != old_sha256):
                raise Refused('Codefile owner, identity, or predecessor drift')
        finally:
            os.close(current)
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
            output.flush()
            os.fchmod(output.fileno(), 0o444)
            os.fsync(output.fileno())
        current = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            latest = os.fstat(current)
            latest_identity = (latest.st_dev, latest.st_ino, latest.st_size, latest.st_mtime_ns, latest.st_ctime_ns)
            latest_content = os.read(current, 16_000_001)
            after_read = os.fstat(current)
            read_identity = (after_read.st_dev, after_read.st_ino, after_read.st_size,
                             after_read.st_mtime_ns, after_read.st_ctime_ns)
            if (latest_identity != identity_before or read_identity != latest_identity
                    or latest.st_uid != owner_uid or latest.st_nlink != 1
                    or hashlib.sha256(latest_content).hexdigest() != old_sha256):
                raise Refused('Codefile changed before replacement')
        finally:
            os.close(current)
        os.rename(temporary, name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
        verify = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
        try:
            result = os.fstat(verify)
            if (not stat.S_ISREG(result.st_mode) or result.st_nlink != 1 or result.st_uid != owner_uid
                    or stat.S_IMODE(result.st_mode) != 0o444
                    or hashlib.sha256(os.read(verify, 16_000_001)).hexdigest() != new_sha256):
                raise Refused('Installed codefile verification failed')
        finally:
            os.close(verify)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
        os.close(directory)
