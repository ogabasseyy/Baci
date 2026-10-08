#!/usr/bin/env python3
"""Root-only, read-only tracer for transition prerequisite attributes.

Reports owner/mode/link-count/symlink/parent facts for every file the
gateway transition ceremony reads, with a per-file verdict naming the
exact failed check. Prints metadata only (no file contents). Never
refuses: every path reports pass/fail unconditionally. Exit 0 always;
the JSON verdicts carry the result.
"""

import argparse
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path


def _load(name):
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).with_name(name + '.py')
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


activator = _load('funding-gateway-transition-activator')
candidate = _load('funding-gateway-transition-candidate')

MAX_BYTES = 1_048_576
GATEWAY_SERVICE = 'baci-savings-gateway.service'
DRAFTS_SERVICE = 'baci-savings-drafts.service'
FUNDING_SERVICE = 'baci-savings-funding.service'
# Mirrors the validators: default graph modes, the single 0550 executable
# helper override, and 0440 renewal archives. The spec test pins these.
GRAPH_DEFAULT_MODES = (0o400, 0o440, 0o444, 0o600, 0o644)
GRAPH_MODE_OVERRIDES = {'managed-inventory-helper.mjs': (0o550,)}
ARCHIVE_MODES = (0o440,)


def spec_table():
    """(label, path, allowed_modes, ceremony_step) mirroring the validators."""
    rows = [
        (
            f'graph:{Path(path).name}', Path(path),
            GRAPH_MODE_OVERRIDES.get(Path(path).name, GRAPH_DEFAULT_MODES),
            'verify-graph',
        )
        for path in sorted(activator.GRAPH)
    ]
    rows += [
        ('live-binding', activator.BINDING_PATH, (0o440,),
         'build-package/check/activate'),
        ('live-evidence', activator.EVIDENCE_PATH, (0o440,),
         'check/activate'),
        ('package-binding', activator.PACKAGE_BINDING_PATH, (0o400, 0o600),
         'check/activate'),
        ('package-manifest', candidate.PACKAGE_MANIFEST_PATH, (0o400, 0o600),
         'check/activate'),
        ('owner-inputs', candidate.OWNER_INPUT_PATH, (0o400, 0o600),
         'check/activate'),
        ('post-renewal-manifest', candidate.POST_RENEWAL_MANIFEST_PATH,
         (0o400, 0o600), 'check/activate'),
        ('gateway-unit', candidate.GATEWAY_UNIT_PATH, (0o444, 0o644),
         'check/activate'),
        ('receipt', candidate.STATE_DIRECTORY / 'receipt.json', (0o400, 0o600),
         'check/activate'),
        ('renewal-receipt', candidate.STATE_DIRECTORY / 'renewal-receipt.json',
         (0o400, 0o600), 'check/activate'),
    ]
    renewals = candidate.STATE_DIRECTORY / 'renewals'
    try:
        names = sorted(entry.name for entry in renewals.iterdir())
    except OSError:
        names = []
    for name in names:
        for leaf in ('binding.json', 'startup-evidence.json'):
            rows.append((
                f'archive:{name}/{leaf}', renewals / name / leaf,
                ARCHIVE_MODES, 'check/activate',
            ))
    return rows


def inspect_file(path, modes, owner_uid):
    """Report lstat facts plus the first failing validator check, if any."""
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        return {'exists': False, 'verdict': 'fail:missing'}
    except OSError as error:
        return {'exists': False, 'verdict': f'fail:unreadable:{type(error).__name__}'}
    facts = {
        'exists': True,
        'symlink': stat.S_ISLNK(metadata.st_mode),
        'regular': stat.S_ISREG(metadata.st_mode),
        'uid': metadata.st_uid,
        'gid': metadata.st_gid,
        'mode': f'{stat.S_IMODE(metadata.st_mode):04o}',
        'nlink': metadata.st_nlink,
        'size': metadata.st_size,
    }
    if facts['symlink']:
        try:
            facts['target'] = os.readlink(path)
        except OSError:
            facts['target'] = '?'
        facts['verdict'] = 'fail:symlink'
        return facts
    if not facts['regular']:
        facts['verdict'] = 'fail:not-regular'
    elif metadata.st_uid != owner_uid:
        facts['verdict'] = 'fail:owner'
    elif stat.S_IMODE(metadata.st_mode) not in modes:
        facts['verdict'] = 'fail:mode'
    elif metadata.st_nlink != 1:
        facts['verdict'] = 'fail:nlink'
    elif metadata.st_size > MAX_BYTES:
        facts['verdict'] = 'fail:too-large'
    else:
        facts['verdict'] = 'pass'
    return facts


def inspect_ancestors(path, owner_uid):
    """Mirror _safe_ancestors: first bad ancestor, if any."""
    for ancestor in (path.parent, *path.parent.parents):
        try:
            metadata = ancestor.lstat()
        except OSError:
            return {'verdict': 'fail:ancestor-unreadable', 'path': str(ancestor)}
        if not stat.S_ISDIR(metadata.st_mode):
            return {'verdict': 'fail:ancestor-notdir', 'path': str(ancestor)}
        if metadata.st_uid != owner_uid:
            return {
                'verdict': 'fail:ancestor-owner', 'path': str(ancestor),
                'uid': metadata.st_uid,
            }
        if metadata.st_mode & 0o022:
            return {
                'verdict': 'fail:ancestor-writable', 'path': str(ancestor),
                'mode': f'{stat.S_IMODE(metadata.st_mode):04o}',
            }
    return {'verdict': 'pass'}


def inspect_absence(path):
    try:
        is_link = path.is_symlink()
    except OSError:
        return {'verdict': 'fail:unreadable'}
    if path.exists() or is_link:
        return {'exists': True, 'verdict': 'fail:already-exists'}
    return {'exists': False, 'verdict': 'pass'}


def service_state(name):
    try:
        completed = subprocess.run(
            ['/usr/bin/systemctl', 'show', name,
             '--property=ActiveState,NeedDaemonReload,MainPID', '--no-pager'],
            capture_output=True, timeout=10,
            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin'},
        )
    except (OSError, subprocess.SubprocessError):
        return {'verdict': 'fail:unreadable'}
    if completed.returncode != 0:
        return {'verdict': 'fail:unreadable'}
    values = {}
    for line in completed.stdout.decode('utf-8', 'replace').splitlines():
        key, separator, value = line.partition('=')
        if separator:
            values[key] = value
    return {
        'active': values.get('ActiveState'),
        'needsReload': values.get('NeedDaemonReload'),
        'hasPid': (values.get('MainPID') or '').isdigit()
        and int(values.get('MainPID')) > 0,
    }


def collect(owner_uid):
    files = []
    for label, path, modes, step in spec_table():
        facts = inspect_file(Path(path), modes, owner_uid)
        entry = {
            'label': label, 'path': str(path), 'step': step,
            'modes': [f'{mode:04o}' for mode in modes],
            **facts,
            'ancestors': inspect_ancestors(Path(path), owner_uid),
        }
        files.append(entry)
    files.append({
        'label': 'provenance-receipt',
        'path': str(candidate.PROVENANCE_PATH),
        'step': 'activate',
        'expect': 'absent',
        **inspect_absence(candidate.PROVENANCE_PATH),
    })
    failed = [
        entry['label'] for entry in files
        if entry['verdict'] != 'pass'
        or entry.get('ancestors', {}).get('verdict', 'pass') != 'pass'
    ]
    return {
        'overall': 'fail' if failed else 'pass',
        'failed': failed,
        'files': files,
        'services': {
            'gateway': service_state(GATEWAY_SERVICE),
            'drafts': service_state(DRAFTS_SERVICE),
            'funding': service_state(FUNDING_SERVICE),
        },
    }


def main(arguments):
    parser = argparse.ArgumentParser()
    parser.add_argument('--owner-uid', type=int, default=0)
    parsed = parser.parse_args(arguments)
    if os.geteuid() != 0:
        print('Transition diagnostic requires root.', file=sys.stderr)
        return 1
    print(json.dumps(collect(parsed.owner_uid), separators=(',', ':')))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
