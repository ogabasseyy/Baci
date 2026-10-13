import hashlib
import os
import stat

from release_contract import _require


def fingerprint(path):
    metadata = path.lstat()
    _require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
             and metadata.st_uid in (0, 65531, 65532) and not metadata.st_mode & 0o022
             and 0 < metadata.st_size <= 16_000_000, 'installation_file_metadata_refused')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        content = handle.read(16_000_001)
        after = os.fstat(handle.fileno())
    _require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
              before.st_ctime_ns) == (metadata.st_dev, metadata.st_ino, metadata.st_size,
              metadata.st_mtime_ns, metadata.st_ctime_ns)
             and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                  before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size,
                  after.st_mtime_ns, after.st_ctime_ns) and len(content) == metadata.st_size,
             'installation_file_changed_during_read')
    return {'sha256': hashlib.sha256(content).hexdigest(), 'uid': metadata.st_uid,
            'gid': metadata.st_gid, 'mode': stat.S_IMODE(metadata.st_mode),
            'size': metadata.st_size}, content


def tree_fingerprint(root, expected_paths):
    observed = {}
    for path in (root, *sorted(root.rglob('*'))):
        metadata = path.lstat()
        _require(not path.is_symlink(), 'installation_tree_symlink_refused')
        relative = str(path.relative_to(root))
        if stat.S_ISDIR(metadata.st_mode):
            _require(metadata.st_uid == 0 and not metadata.st_mode & 0o022,
                     'installation_directory_metadata_refused')
            observed[relative] = {'uid': metadata.st_uid, 'gid': metadata.st_gid,
                                  'mode': stat.S_IMODE(metadata.st_mode)}
        else:
            _require(relative in expected_paths, 'installation_unknown_file_refused')
            row, content = fingerprint(path)
            expected = expected_paths[relative]
            _require(row['sha256'] == expected['sha256'] and row['uid'] == expected['uid']
                     and row['gid'] == expected['gid'] and row['mode'] == expected['mode'],
                     'installation_predecessor_pin_mismatch')
            observed[relative] = row
    _require(set(observed) == {'.', 'code', 'config', *expected_paths},
             'installation_tree_shape_refused')
    return observed


def directory(path, owner=0, group=0, mode=0o700):
    _require(not path.exists() and not path.is_symlink(), 'installation_output_exists')
    path.mkdir(mode=0o700)
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchown(descriptor, owner, group)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def place(path, content, owner=0, group=0, mode=0o600):
    _require(isinstance(content, bytes) and 0 < len(content) <= 16_000_000,
             'installation_content_refused')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        os.fchown(handle.fileno(), owner, group)
        os.fchmod(handle.fileno(), mode)
        handle.flush()
        os.fsync(handle.fileno())


def retained_replace(path, content, predecessor, audit):
    actual, old_content = fingerprint(path)
    _require(actual == predecessor, 'installation_unit_predecessor_changed')
    backup = audit / path.name
    place(backup, old_content)
    candidate = path.with_name(path.name + '.financial-renewal')
    place(candidate, content, group=actual['gid'], mode=actual['mode'])
    _require(fingerprint(path)[0] == predecessor, 'installation_unit_predecessor_changed')
    os.replace(candidate, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
