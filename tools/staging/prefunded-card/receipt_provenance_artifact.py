import os
import stat
import tempfile
from treasury_owner_contract import Refused


def verified_content(parent, name, expected, directory_owner):
    descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid not in (0, directory_owner)
                or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o444
                or not 0 < before.st_size <= 12_000_000):
            raise Refused('Intake file metadata changed')
        current = handle.read(12_000_001)
        after = os.fstat(handle.fileno())
    if (current not in expected or len(current) != before.st_size
            or (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) !=
            (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
        raise Refused('Foreign intake bytes retained')


def restore_captured(parent, staging):
    try:
        os.link('captured.mjs', 'intake-server.mjs', src_dir_fd=staging, dst_dir_fd=parent,
                follow_symlinks=False)
    except OSError:
        raise Refused('Concurrent intake entry retained; captured original retained in owner audit') from None
    os.unlink('captured.mjs', dir_fd=staging)
    os.fsync(parent)
    os.fsync(staging)


def replace_intake_artifact(directory, content, expected, uid, gid, directory_owner, audit):
    audit_metadata = os.lstat(audit)
    if (not stat.S_ISDIR(audit_metadata.st_mode) or audit_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(audit_metadata.st_mode) != 0o700):
        raise Refused('Owner artifact audit directory refused')
    staging_path = tempfile.mkdtemp(prefix='intake-replacement.', dir=audit)
    staging = os.open(staging_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    parent = None
    try:
        parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        metadata = os.fstat(parent)
        if (metadata.st_uid != directory_owner or stat.S_IMODE(metadata.st_mode) != 0o700
                or metadata.st_dev != os.fstat(staging).st_dev):
            raise Refused('Intake directory or filesystem changed')
        verified_content(parent, 'intake-server.mjs', expected, directory_owner)
        descriptor = os.open('candidate.mjs', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=staging)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fchown(handle.fileno(), uid, gid)
            os.fchmod(handle.fileno(), 0o444)
            os.fsync(handle.fileno())
        os.fsync(staging)
        os.rename('intake-server.mjs', 'captured.mjs', src_dir_fd=parent, dst_dir_fd=staging)
        try:
            os.fsync(parent)
            os.fsync(staging)
            verified_content(staging, 'captured.mjs', expected, directory_owner)
            os.link('candidate.mjs', 'intake-server.mjs', src_dir_fd=staging, dst_dir_fd=parent,
                    follow_symlinks=False)
        except Exception:
            restore_captured(parent, staging)
            raise
        os.unlink('candidate.mjs', dir_fd=staging)
        os.fsync(parent)
        os.fsync(staging)
    finally:
        if parent is not None:
            os.close(parent)
        os.close(staging)
