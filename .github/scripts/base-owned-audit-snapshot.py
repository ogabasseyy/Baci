#!/usr/bin/env python3
"""Materialize PR-owned audit inputs as inert Git blobs, never as a checkout."""
import argparse
import os
from pathlib import Path
import re
import selectors
import subprocess
import time
import sys

MAX_BLOB_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024
MAX_FILES = 3000
MAX_GIT_OUTPUT = 8 * 1024 * 1024
OID = re.compile(r'^[0-9a-f]{40}$')
TRUSTED_FILES = {
    '.github/workflows/security.yml', '.github/workflows/semgrep-tripwire.yml',
    '.github/workflows/muse-code-review.yml', '.github/workflows/muse-code-pin-update.yml',
    '.github/workflows/muse-review-selftest.yml', '.github/workflows/base-owned-pr-audit.yml',
    '.github/CODEOWNERS',
}
TRUSTED_PREFIXES = (
    '.github/scripts/muse-review/', '.github/scripts/muse-pin-update',
    '.github/scripts/semgrep-sarif', '.github/scripts/semgrep_sarif_',
    '.github/scripts/base-owned-audit',
)

class SnapshotError(Exception):
    pass

def git(repo, *args):
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/dev/null', 'LANG': 'C',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_TERMINAL_PROMPT': '0'}
    process = None
    selector = selectors.DefaultSelector()
    try:
        process = subprocess.Popen(
            ['git', '-C', str(repo), '-c', 'core.hooksPath=/dev/null', *args],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env,
        )
        selector.register(process.stdout, selectors.EVENT_READ)
        output = bytearray()
        deadline = time.monotonic() + 60
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise SnapshotError('git object operation timed out')
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            output.extend(chunk)
            if len(output) > MAX_GIT_OUTPUT:
                raise SnapshotError('git object output exceeds limit')
        if process.wait(timeout=max(0.01, deadline - time.monotonic())) != 0:
            raise SnapshotError('git object operation failed')
        return bytes(output)
    except (OSError, subprocess.SubprocessError) as error:
        raise SnapshotError('git object operation failed') from error
    finally:
        selector.close()
        if process is not None:
            if process.poll() is None:
                process.kill()
                process.wait()
            if process.stdout is not None:
                process.stdout.close()

def trusted(path):
    return path in TRUSTED_FILES or path.startswith(TRUSTED_PREFIXES)

def stage_snapshot(repo, base, head, destination):
    if not OID.fullmatch(base) or not OID.fullmatch(head):
        raise SnapshotError('invalid immutable commit id')
    for revision in (base, head):
        git(repo, 'cat-file', '-e', revision + '^{commit}')
    # The PR must incorporate the exact base whose auditor is being used.
    git(repo, 'merge-base', '--is-ancestor', base, head)
    changed = git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames',
                  '--name-only', '-z', base, head, '--', '.github')
    try:
        paths = [path.decode('utf-8') for path in changed.split(b'\0') if path]
    except UnicodeDecodeError as error:
        raise SnapshotError('invalid path encoding') from error
    trusted_changed = any(trusted(path) for path in paths)
    tree = git(repo, 'ls-tree', '-r', '-z', '--full-tree', head, '--', '.github')
    entries = [entry for entry in tree.split(b'\0') if entry]
    if len(entries) > MAX_FILES:
        raise SnapshotError('too many audit files')
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    total = 0
    for entry in entries:
        try:
            metadata, raw_path = entry.split(b'\t', 1)
            mode, kind, oid = metadata.decode('ascii').split(' ')
            path = raw_path.decode('utf-8')
        except (ValueError, UnicodeDecodeError) as error:
            raise SnapshotError('malformed tree entry') from error
        parts = path.split('/')
        if (mode not in ('100644', '100755') or kind != 'blob' or
            not OID.fullmatch(oid) or parts[0] != '.github' or
            any(part in ('', '.', '..') for part in parts)):
            raise SnapshotError('unsafe audit tree entry')
        size = int(git(repo, 'cat-file', '-s', oid))
        total += size
        if size > MAX_BLOB_BYTES or total > MAX_TOTAL_BYTES:
            raise SnapshotError('audit tree exceeds size limit')
        data = git(repo, 'cat-file', 'blob', oid)
        if len(data) != size:
            raise SnapshotError('blob length mismatch')
        target = destination.joinpath(*parts)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(data)
    return trusted_changed

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    try:
        changed = stage_snapshot(args.repo, args.base, args.head, args.destination)
    except (SnapshotError, OSError, ValueError) as error:
        print(f'audit snapshot failed: {type(error).__name__}', file=sys.stderr)
        return 1
    print('true' if changed else 'false')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
