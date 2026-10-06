import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import time


SOURCE = Path('/home/bassey/baci-savings-engagement-20260925/owner-bundle.tar.gz')
LIMIT = 400 * 1024 * 1024
EXPIRY = 1790697550


def verify_archive(content):
    entries = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
        for member in archive:
            if not member.isfile() or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}', member.name) or member.name in entries:
                raise RuntimeError('Unsafe or duplicate archive entry')
            total += member.size
            if member.size < 0 or total > LIMIT or len(entries) > 40:
                raise RuntimeError('Oversized owner bundle')
            handle = archive.extractfile(member)
            if handle is None:
                raise RuntimeError('Missing archive content')
            entries[member.name] = handle.read()
    manifest = entries.pop('SHA256SUMS', None)
    if manifest is None or 'owner.py' not in entries:
        raise RuntimeError('Incomplete owner bundle')
    expected = {}
    for line in manifest.splitlines():
        match = re.fullmatch(rb'([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]{0,120})', line)
        if not match:
            raise RuntimeError('Malformed inner manifest')
        digest, name = match.groups()
        name = name.decode('ascii')
        if name in expected:
            raise RuntimeError('Duplicate inner manifest entry')
        expected[name] = digest.decode('ascii')
    if set(entries) != set(expected) or any(hashlib.sha256(data).hexdigest() != expected[name] for name, data in entries.items()):
        raise RuntimeError('Owner bundle content mismatch')
    return entries


def run(expected_sha256, resume=False):
    if os.geteuid() != 0 or time.time() >= EXPIRY or not re.fullmatch(r'[a-f0-9]{64}', expected_sha256):
        raise RuntimeError('Owner approval unavailable or expired')
    descriptor = os.open(SOURCE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != pwd.getpwnam('bassey').pw_uid or before.st_nlink != 1 or before.st_mode & 0o077 or before.st_size > LIMIT:
            raise RuntimeError('Unsafe staging archive')
        content = handle.read(LIMIT + 1)
        after = os.fstat(handle.fileno())
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or hashlib.sha256(content).hexdigest() != expected_sha256:
        raise RuntimeError('Staging archive hash mismatch')
    entries = verify_archive(content)
    destination = Path(tempfile.mkdtemp(prefix='baci-savings-engagement.', dir='/root'))
    os.chmod(destination, 0o700)
    for name, data in entries.items():
        descriptor = os.open(destination / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    print(json.dumps({'stage': 'owner-bundle-verified', 'directory': str(destination), 'files': len(entries)}), flush=True)
    environment = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C', 'LC_ALL': 'C'}
    command = ['/usr/bin/python3', str(destination / 'owner.py')]
    if resume:
        command.append('--resume')
    return subprocess.run(command, cwd=destination, env=environment, stdin=subprocess.DEVNULL).returncode


if __name__ == '__main__':
    os.umask(0o077)
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument('digest')
        parser.add_argument('--resume', action='store_true')
        arguments = parser.parse_args()
        raise SystemExit(run(arguments.digest, arguments.resume))
    except Exception:
        print('Staging bundle refused; no unverified code executed.', flush=True)
        raise SystemExit(1) from None
