#!/usr/bin/env python3
"""Owner-run, rollback-safe artifact-only upgrade for staging savings drafts."""

import argparse
import ctypes
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from artifact_validation import Refused, read_manifest
from descriptor_copy import copy_verified
from systemd_identity import SERVICE, SMOKE, assert_timer, assert_unit, capture_live, command, show, stop_owned


DESTINATION = Path('/opt/baci-savings-drafts')
SERVICE_FRAGMENT = '/etc/systemd/system/baci-savings-drafts.service'
SMOKE_FRAGMENT = '/etc/systemd/system/baci-savings-drafts-smoke.service'


class UnsafeSmokeState(Refused):
    pass


def exchange(left: Path, right: Path) -> None:
    library = ctypes.CDLL(None, use_errno=True)
    result = library.renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2)
    if result != 0:
        raise OSError(ctypes.get_errno(), 'renameat2 exchange failed')


def probe(port: int) -> bool:
    request = urllib.request.Request('http://127.0.0.1:%d/api/storefront/customer/savings/drafts' % port,
                                     headers={'Host': 'staging.ogabassey.com', 'X-Forwarded-Host': 'staging.ogabassey.com', 'X-Forwarded-Proto': 'https'})
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=3) as response:
            return response.status == 401
    except urllib.error.HTTPError as error:
        return error.code == 401
    except (OSError, urllib.error.URLError):
        return False


def start_owned(unit: str, fragment: str, restricted: bool):
    assert_unit(unit, fragment, restricted)
    command(['/usr/bin/systemctl', 'start', unit])
    for _ in range(15):
        try:
            return capture_live(unit, fragment, restricted=restricted)
        except Refused:
            pass
        time.sleep(1)
    raise Refused(f'{unit} did not start with the reviewed identity.')


def wait_for_401(invocation, fragment: str, port: int, restricted: bool) -> None:
    for _ in range(15):
        current = capture_live(invocation.unit, fragment, restricted=restricted)
        if current != invocation:
            raise Refused(f'{invocation.unit} invocation changed during health check.')
        if probe(port):
            return
        time.sleep(1)
    raise Refused(f'{invocation.unit} did not return 401.')


def smoke_is_inactive() -> bool:
    try:
        return show(SMOKE, 'ActiveState') == 'inactive'
    except Exception:
        return False


def smoke() -> None:
    invocation = None
    try:
        invocation = start_owned(SMOKE, SMOKE_FRAGMENT, restricted=True)
        wait_for_401(invocation, SMOKE_FRAGMENT, 4794, restricted=True)
    except Exception:
        if invocation is not None:
            try:
                stop_owned(invocation, SMOKE_FRAGMENT, restricted=True)
            except Exception as error:
                if not smoke_is_inactive():
                    raise UnsafeSmokeState('Smoke ownership is unproven; manual recovery required.') from error
                raise
        elif not smoke_is_inactive():
            raise UnsafeSmokeState('Smoke state is unproven; manual recovery required.')
        raise
    try:
        stop_owned(invocation, SMOKE_FRAGMENT, restricted=True)
    except Exception as error:
        if not smoke_is_inactive():
            raise UnsafeSmokeState('Smoke ownership is unproven; manual recovery required.') from error
        raise


def restore(old_artifact: Path, new_invocation) -> None:
    if new_invocation is not None:
        stop_owned(new_invocation, SERVICE_FRAGMENT, restricted=False)
    if not old_artifact.is_dir() or old_artifact.is_symlink():
        raise Refused('Rollback artifact is unavailable.')
    exchange(DESTINATION, old_artifact)
    old_invocation = start_owned(SERVICE, SERVICE_FRAGMENT, restricted=False)
    wait_for_401(old_invocation, SERVICE_FRAGMENT, 4792, restricted=False)


def upgrade(source: Path, manifest: Path, manifest_hash: str) -> Path:
    if os.getuid() != 0 or os.geteuid() != 0:
        raise Refused('Upgrade must be run by the owner wrapper as root.')
    entries = read_manifest(manifest, manifest_hash)
    old_invocation = capture_live(SERVICE, SERVICE_FRAGMENT, restricted=False)
    assert_timer()
    candidate = copy_verified(source, DESTINATION, entries)
    backup = DESTINATION.parent / f'{DESTINATION.name}.rollback-{int(time.time())}'
    if (not DESTINATION.is_dir() or DESTINATION.is_symlink()
            or backup.exists() or backup.is_symlink()):
        raise Refused('Destination or rollback path is unsafe.')
    exchanged = False
    old_stopped = False
    new_start_attempted = False
    new_invocation = None
    try:
        old_invocation = capture_live(SERVICE, SERVICE_FRAGMENT, restricted=False)
        assert_timer()
        stop_owned(old_invocation, SERVICE_FRAGMENT, restricted=False)
        old_stopped = True
        exchange(DESTINATION, candidate)
        exchanged = True
        os.replace(candidate, backup)
        smoke()
        assert_timer()
        new_start_attempted = True
        new_invocation = start_owned(SERVICE, SERVICE_FRAGMENT, restricted=False)
        wait_for_401(new_invocation, SERVICE_FRAGMENT, 4792, restricted=False)
        return backup
    except UnsafeSmokeState:
        raise
    except Exception:
        if exchanged and new_start_attempted and new_invocation is None:
            raise Refused('Replacement invocation is unproven; refusing unsafe rollback.')
        if exchanged:
            restore(backup if backup.exists() else candidate, new_invocation)
        elif old_stopped:
            restored = start_owned(SERVICE, SERVICE_FRAGMENT, restricted=False)
            wait_for_401(restored, SERVICE_FRAGMENT, 4792, restricted=False)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upgrade', action='store_true', required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--manifest-sha256', required=True)
    arguments = parser.parse_args()
    try:
        backup = upgrade(arguments.source, arguments.manifest, arguments.manifest_sha256)
    except (OSError, Refused, subprocess.SubprocessError, ValueError):
        print('Upgrade refused or failed; existing units, environment, timers, and network configuration were not changed.')
        return 1
    print(json.dumps({'status': 'candidate-upgraded', 'rollbackBackup': str(backup), 'activation': 'owner-reviewed'}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
