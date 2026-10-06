#!/usr/bin/env python3
"""Root-only, redacted metadata diagnosis for the managed funding gateway."""

import argparse
from datetime import UTC, datetime
import hashlib
import json
import os
import stat
import subprocess
import sys
from pathlib import Path
from typing import Callable


SERVICE = 'baci-savings-gateway.service'
STATE = Path('/var/lib/baci-savings-gateway-install')
RECEIPTS = (STATE / 'receipt.json', STATE / 'renewal-receipt.json')
UNIT = Path('/etc/systemd/system/baci-savings-gateway.service')
BINDING = Path('/etc/baci-savings-gateway/binding.json')
MANAGED_GATEWAY = Path('/opt/baci-savings-gateway/managed-gateway.mjs')
SINCE = '2026-09-22 19:00:00 UTC'
JOURNAL_STAGES = {
    'Managed gateway withdrawn; operator review and fresh startup evidence required.': 'withdrawn',
    'Managed gateway stopped.': 'stopped',
}


class Refused(RuntimeError):
    pass


def _safe_ancestors(path: Path, owner_uid: int) -> None:
    for ancestor in reversed((path.parent, *path.parent.parents)):
        try:
            metadata = ancestor.lstat()
        except OSError as error:
            raise Refused('Protected metadata path is unavailable.') from error
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_mode & 0o022:
            raise Refused('Protected metadata path is unsafe.')


def _hash_metadata(
    path: Path, modes: tuple[int, ...], owner_uid: int = 0
) -> dict[str, int | str]:
    _safe_ancestors(path, owner_uid)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise Refused('Protected metadata input is unavailable.') from error
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) not in modes
        ):
            raise Refused('Protected metadata input is unsafe.')
        digest = hashlib.sha256()
        for block in iter(lambda: handle.read(65536), b''):
            digest.update(block)
        after = os.fstat(handle.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ):
        raise Refused('Protected metadata input changed while read.')
    return {
        'sha256': digest.hexdigest(),
        'mode': f'{stat.S_IMODE(before.st_mode):04o}',
        'size': before.st_size,
    }


def _safe_json(path: Path, modes: tuple[int, ...], owner_uid: int) -> tuple[dict[str, object], dict[str, int | str]]:
    _safe_ancestors(path, owner_uid)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise Refused('Protected metadata input is unavailable.') from error
    with os.fdopen(descriptor, 'rb') as handle:
        metadata = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != owner_uid
            or metadata.st_nlink != 1
            or stat.S_IMODE(metadata.st_mode) not in modes
        ):
            raise Refused('Protected metadata input is unsafe.')
        content = handle.read()
    try:
        value = json.loads(content)
    except (TypeError, ValueError) as error:
        raise Refused('Protected metadata input is not valid JSON.') from error
    if not isinstance(value, dict):
        raise Refused('Protected metadata input has an invalid shape.')
    return value, {
        'sha256': hashlib.sha256(content).hexdigest(),
        'mode': f'{stat.S_IMODE(metadata.st_mode):04o}',
        'size': metadata.st_size,
    }


def _journal_stage(journal: str) -> str:
    for line in reversed(journal.splitlines()):
        if line in JOURNAL_STAGES:
            return JOURNAL_STAGES[line]
    return 'unclassified'


def _run(arguments: list[str]) -> str:
    completed = subprocess.run(
        arguments,
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return completed.stdout if completed.returncode == 0 else ''


def _systemd_metadata(run: Callable[[list[str]], str]) -> dict[str, str]:
    values = run(
        [
            '/usr/bin/systemctl',
            'show',
            SERVICE,
            '--property=ActiveState,MainPID,Result,ExecMainStatus',
            '--no-pager',
        ]
    )
    allowed = {
        'ActiveState': {'active', 'activating', 'deactivating', 'failed', 'inactive'},
        'MainPID': None,
        'Result': {'core-dump', 'exit-code', 'oom-kill', 'protocol', 'resources', 'signal', 'success', 'timeout', 'watchdog'},
        'ExecMainStatus': None,
    }
    parsed = {}
    for line in values.splitlines():
        key, separator, value = line.partition('=')
        if key not in allowed:
            continue
        if not separator or key in parsed or (allowed[key] is not None and value not in allowed[key]) or (allowed[key] is None and not value.isdigit()):
            raise Refused('Systemd metadata is invalid.')
        parsed[key] = value
    if set(parsed) != set(allowed):
        raise Refused('Systemd metadata is incomplete.')
    return {
        'activeState': parsed['ActiveState'],
        'mainPid': parsed['MainPID'],
        'result': parsed['Result'],
        'execMainStatus': parsed['ExecMainStatus'],
    }


def _expiry_epoch(value: object) -> int:
    if not isinstance(value, str):
        raise Refused('Binding expiry is invalid.')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise Refused('Binding expiry is invalid.') from error
    if parsed.tzinfo is None or parsed.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z') != value:
        raise Refused('Binding expiry is invalid.')
    return int(parsed.timestamp())


def _renewal_linkage(owner_uid: int) -> dict[str, object]:
    renewal, receipt_metadata = _safe_json(RECEIPTS[1], (0o400, 0o600), owner_uid)
    predecessor = _hash_metadata(RECEIPTS[0], (0o400, 0o600), owner_uid)['sha256']
    archived = renewal.get('archivedEvidence')
    expected = (
        renewal.get('predecessorReceiptSha256'),
        archived.get('bindingSha256') if isinstance(archived, dict) else None,
        archived.get('startupEvidenceSha256') if isinstance(archived, dict) else None,
    )
    if set(renewal) != {'version', 'activatedAt', 'expiresAt', 'predecessorReceiptSha256', 'archivedEvidence'} or renewal.get('version') != 1 or expected[0] != predecessor or not all(isinstance(value, str) and len(value) == 64 and all(character in '0123456789abcdef' for character in value) for value in expected):
        raise Refused('Renewal receipt linkage is invalid.')
    matches = []
    for archive in (RECEIPTS[1].parent / 'renewals').iterdir():
        if not archive.name.isdecimal() or archive.is_symlink() or not archive.is_dir():
            continue
        try:
            binding = _hash_metadata(archive / 'binding.json', (0o440,), owner_uid)['sha256']
            evidence = _hash_metadata(archive / 'startup-evidence.json', (0o440,), owner_uid)['sha256']
        except Refused:
            continue
        if (binding, evidence) == expected[1:]:
            matches.append(archive.name)
    if len(matches) != 1:
        raise Refused('Renewal archive linkage is not unique.')
    return {'receiptSha256': receipt_metadata['sha256'], 'predecessorReceiptSha256': expected[0], 'archiveId': matches[0]}


def collect_diagnostic(
    run: Callable[[list[str]], str] = _run, owner_uid: int = 0
) -> dict[str, object]:
    journal = run(
        [
            '/usr/bin/journalctl',
            f'--unit={SERVICE}',
            f'--since={SINCE}',
            '--lines=200',
            '--no-pager',
            '--output=cat',
        ]
    )
    binding, binding_metadata = _safe_json(BINDING, (0o440,), owner_uid)
    return {
        'service': _systemd_metadata(run),
        'journal': {'redactedStage': _journal_stage(journal)},
        'receipt': _hash_metadata(RECEIPTS[0], (0o400, 0o600), owner_uid),
        'renewal': _renewal_linkage(owner_uid),
        'binding': {
            'sha256': binding_metadata['sha256'],
            'leaseExpiresAtEpoch': _expiry_epoch(binding.get('leaseExpiresAt')),
        },
        'unit': _hash_metadata(UNIT, (0o444, 0o644), owner_uid),
        'managedGateway': _hash_metadata(MANAGED_GATEWAY, (0o440,), owner_uid),
    }


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', required=True)
    parsed = parser.parse_args(arguments)
    try:
        if os.geteuid() != 0:
            raise Refused('Owner-reviewed root execution is required.')
        result = collect_diagnostic()
    except (OSError, RuntimeError, subprocess.SubprocessError):
        print('Funding gateway diagnostic refused; no service change occurred.', file=sys.stderr)
        return 1
    if parsed.check:
        print(json.dumps(result, separators=(',', ':'), sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
