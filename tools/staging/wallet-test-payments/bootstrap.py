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
import tarfile
import tempfile
import time


SOURCE = Path('/home/bassey/baci-test-payments-20260925/owner-bundle.tar.gz')
RECOVERY_SOURCE = Path('/home/bassey/baci-test-payments-nginx-recovery-20260925/owner-bundle.tar.gz')
LIMIT = 10 * 1024 * 1024
EXPIRY = 1790697550


def verify_archive(content):
    entries = {}
    total = 0
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as archive:
        for member in archive:
            if not member.isfile() or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,120}', member.name) or member.name in entries:
                raise RuntimeError('Unsafe archive entry')
            total += member.size
            if member.size < 0 or total > LIMIT or len(entries) >= 32:
                raise RuntimeError('Oversized owner bundle')
            handle = archive.extractfile(member)
            if handle is None:
                raise RuntimeError('Missing archive content')
            entries[member.name] = handle.read()
    manifest = entries.pop('SHA256SUMS', None)
    if manifest is None or not {'install.py', 'bundle.json'}.issubset(entries):
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


def activate(destination, manifest_digest, nginx_digest, recover_nginx=False):
    environment = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
    entrypoint = 'nginx_recover.py' if recover_nginx else 'install.py'
    mode = [] if recover_nginx else ['--install']
    command = ['/usr/bin/python3', str(destination / entrypoint), *mode, '--bundle', str(destination), '--bundle-manifest-sha256', manifest_digest, '--nginx-sha256', nginx_digest]
    return subprocess.run(command, cwd=destination, env=environment).returncode


def run(expected_sha256, manifest_digest, nginx_digest, recover_nginx=False):
    if os.geteuid() != 0 or time.time() >= EXPIRY or not all(re.fullmatch(r'[a-f0-9]{64}', value) for value in (expected_sha256, manifest_digest, nginx_digest)):
        raise RuntimeError('Owner approval unavailable or expired')
    source = RECOVERY_SOURCE if recover_nginx else SOURCE
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_uid != pwd.getpwnam('bassey').pw_uid or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > LIMIT:
            raise RuntimeError('Unsafe staging archive')
        content = handle.read(LIMIT + 1)
        after = os.fstat(handle.fileno())
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or hashlib.sha256(content).hexdigest() != expected_sha256:
        raise RuntimeError('Staging archive hash mismatch')
    entries = verify_archive(content)
    if recover_nginx and 'nginx_recover.py' not in entries:
        raise RuntimeError('Route recovery entrypoint missing')
    if hashlib.sha256(entries['bundle.json']).hexdigest() != manifest_digest:
        raise RuntimeError('Inner bundle manifest changed')
    destination = Path(tempfile.mkdtemp(prefix='baci-test-payments.', dir='/root'))
    os.chmod(destination, 0o700)
    for name, data in entries.items():
        descriptor = os.open(destination / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    print(json.dumps({'stage': 'owner-bundle-verified', 'directory': str(destination), 'files': len(entries)}), flush=True)
    return activate(destination, manifest_digest, nginx_digest, recover_nginx)


if __name__ == '__main__':
    os.umask(0o077)
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument('digest')
        parser.add_argument('manifest_digest')
        parser.add_argument('nginx_digest')
        parser.add_argument('--recover-nginx', action='store_true')
        arguments = parser.parse_args()
        raise SystemExit(run(arguments.digest, arguments.manifest_digest, arguments.nginx_digest, arguments.recover_nginx))
    except Exception:
        print('Test-payment bundle refused; no unverified code executed.', flush=True)
        raise SystemExit(1) from None
