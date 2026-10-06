#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import stat
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path


CODE = Path('/opt/baci-savings-gateway')
CONFIG = Path('/etc/baci-savings-gateway')
STATE = Path('/var/lib/baci-savings-gateway-install')
RUNNER = Path(__file__).with_name('funding-gateway-recovery-runner.mjs')
DEADLINE = 1790697550
PINS = {
    CONFIG / 'binding.json': ('8e1b122d5fc91ca0b3eab43e5798c235cfe5dcd93cc1ea0998703e718d3d6ba4', (0o440,)),
    STATE / 'receipt.json': ('c8b95a4eb3c8d6306f138e157a32bdf884b76474979cdbc25e0e9bcc988941c5', (0o400, 0o600)),
    STATE / 'renewal-receipt.json': ('c85c3e31c5cd8770363aad26da0761a0b3810e697c245efd4da97bfda1d82fef', (0o400, 0o600)),
    Path('/etc/systemd/system/baci-savings-gateway.service'): ('8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3', (0o444, 0o644)),
    CODE / 'managed-gateway-cli.mjs': ('314f63daa895429a5ba4134e2b748edcc5f0c41965a3b6740ce102fd69162866', (0o440,)),
    CODE / 'managed-gateway.mjs': ('94f3d2ecbf6b1adc437b84c75afc6b8a921b19d212dcfe34f8625e84bae50825', (0o440,)),
    CODE / 'managed-files.mjs': ('d9d0c6cbfeddbf6ecd249dd9760d8cd09f38880fdcbefc7a0cdbd79e1553b061', (0o440,)),
    CODE / 'managed-inventory-helper.mjs': ('e78e34607bab7b5eac71878527081f808199e89f999d46c638b5ac298529a80d', (0o550,)),
    CODE / 'private-routing.mjs': ('8aa326f61e6de815a8cd6a16aca1fbae92eb8db925e0d65dc4b25a93c32a0617', (0o440,)),
    CODE / 'private-routing-inventory.mjs': ('f8feff6a3b48645f0ae44d25cf1ab18952e0c11510a2aeac2f6f6cd898c4ddbd', (0o440,)),
    CODE / 'private-routing-supervisor-inventory.mjs': ('6205de16870dfb1e5219df2cafc2fdd6252505d0f3349a1064e0ffe8b49f7781', (0o440,)),
    CODE / 'private-routing-supervisor-child.py': ('6dfdedd0d182d8b836c7a67b30d50c7049e6f7b5272ceb7ba4da507b2723b16d', (0o440,)),
    CODE / 'compose.mjs': ('7e34a257b21c9527d97aaac4ffc3957225b55d3be6e08455bd7b272eba5575dd', (0o440,)),
}
RUNNER_SHA256 = 'db7eb80856fdbc707b4ba135ea57f88dadab1f2cb79b0b81efa7da3738761502'


class Refused(RuntimeError):
    pass


def _ancestors(path: Path, owner: int) -> None:
    for parent in reversed((path.parent, *path.parent.parents)):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
            raise Refused('Unsafe owner input path.')


def secure_bytes(path: Path, modes: tuple[int, ...], owner: int = 0) -> bytes:
    _ancestors(path, owner)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != owner or before.st_nlink != 1 or stat.S_IMODE(before.st_mode) not in modes:
            raise Refused('Unsafe owner input.')
        with os.fdopen(descriptor, 'rb', closefd=False) as handle:
            content = handle.read(262145)
        after = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    if len(content) > 262144 or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise Refused('Owner input changed.')
    return content


def _pinned(path: Path, expected: str, modes: tuple[int, ...], owner: int = 0) -> bytes:
    content = secure_bytes(path, modes, owner)
    if hashlib.sha256(content).hexdigest() != expected:
        raise Refused('Pinned owner input differs.')
    return content


def _json(content: bytes) -> dict[str, object]:
    try:
        value = json.loads(content)
    except (TypeError, ValueError) as error:
        raise Refused('Owner receipt is invalid.') from error
    if not isinstance(value, dict):
        raise Refused('Owner receipt is invalid.')
    return value


def _expiry(binding: dict[str, object], now: int) -> None:
    value = binding.get('leaseExpiresAt')
    if not isinstance(value, str):
        raise Refused('Binding expiry is invalid.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise Refused('Binding expiry is invalid.') from error
    if parsed.tzinfo is None or parsed.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z') != value or int(parsed.timestamp()) != DEADLINE or now >= DEADLINE:
        raise Refused('Binding expiry is invalid.')


def validate(owner: int = 0, now: int | None = None) -> None:
    now = int(datetime.now(UTC).timestamp()) if now is None else now
    files = {path: _pinned(path, digest, modes, owner) for path, (digest, modes) in PINS.items()}
    _pinned(RUNNER, RUNNER_SHA256, (0o500, 0o700), owner)
    binding = _json(files[CONFIG / 'binding.json'])
    _expiry(binding, now)
    receipt = _json(files[STATE / 'receipt.json'])
    renewal = _json(files[STATE / 'renewal-receipt.json'])
    archived = renewal.get('archivedEvidence')
    if renewal.get('version') != 1 or renewal.get('predecessorReceiptSha256') != hashlib.sha256(files[STATE / 'receipt.json']).hexdigest() or not isinstance(archived, dict):
        raise Refused('Renewal receipt linkage is invalid.')
    archive = STATE / 'renewals' / '1790092747'
    expected = (archived.get('bindingSha256'), archived.get('startupEvidenceSha256'))
    actual = (hashlib.sha256(secure_bytes(archive / 'binding.json', (0o440,), owner)).hexdigest(), hashlib.sha256(secure_bytes(archive / 'startup-evidence.json', (0o440,), owner)).hexdigest())
    if not all(isinstance(value, str) and len(value) == 64 for value in expected) or actual != expected or not receipt:
        raise Refused('Renewal archive linkage is invalid.')


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--recover', action='store_true')
    parsed = parser.parse_args(arguments)
    try:
        if os.geteuid() != 0 or parsed.check == parsed.recover:
            raise Refused('Root recovery invocation required.')
        validate()
        if parsed.recover:
            subprocess.run(['/usr/bin/node', str(RUNNER), '--recover'], check=True, timeout=30)
    except (OSError, Refused, subprocess.SubprocessError):
        print('Funding gateway recovery refused; no binding change occurred.', file=sys.stderr)
        return 1
    if parsed.check:
        print('Funding gateway recovery preflight passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
