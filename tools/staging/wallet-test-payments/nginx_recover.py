#!/usr/bin/env python3
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
from typing import Callable, Tuple

from install import BASELINE_ROUTES, NGINX_TARGET, ROUTES, probe, render_nginx, verify_manual_artifact, wait_for_routes
from install_contract import DEADLINE_TIMER, EXPIRES_AT, EXPIRY_EPOCH, ROOT, SERVICE, render_deadline_units, render_unit
from install_io import InstallRefused, atomic_write, load_bundle, read_root_file

STATE_ROOT = Path('/var/lib/baci-staging-test-payments')
PREDECESSOR = STATE_ROOT / 'nginx-predecessor.conf'
CANDIDATE = STATE_ROOT / 'nginx-recovery-candidate.conf'
LOCK = STATE_ROOT / 'nginx-recovery.lock'
PREDECESSOR_SHA256 = '607cb3c3235fb7d1001dd815a96d359654103e73df635e66613476b691f7277b'
TIMER_PATH = Path('/etc/systemd/system') / DEADLINE_TIMER
SERVICE_PATH = Path('/etc/systemd/system') / SERVICE
PAYMENT_ROUTE = '/api/storefront/customer/wallet/top-up/initialize'
GOALS_ROUTE = '/api/storefront/customer/savings/goals'
TIMER_CALENDAR = f'OnCalendar={EXPIRES_AT.replace("T", " ").replace("Z", " UTC")}'
NEW_ROUTE_EXPECTATIONS = tuple([('POST', path, 401) for path, _ in ROUTES] + [('GET', path, 405) for path, _ in ROUTES])

Fingerprint = Tuple[int, int, int, int, int]
Snapshot = Tuple[bytes, Fingerprint]

def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()

def fingerprint(metadata: os.stat_result) -> Fingerprint:
    return metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns

def validate_predecessor(content: bytes) -> None:
    if digest(content) != PREDECESSOR_SHA256:
        raise InstallRefused('Nginx predecessor receipt does not match the reviewed hash')

def choose_target(predecessor: bytes, live: bytes) -> bytes:
    rendered = render_nginx(predecessor, digest(predecessor))
    if live not in (predecessor, rendered):
        raise InstallRefused('Live Nginx configuration is neither reviewed predecessor nor union')
    return rendered

def replace_if_unchanged(
    predecessor: bytes,
    expected_fingerprint: Fingerprint,
    rendered: bytes,
    snapshot: Callable[[], Snapshot],
    verify_candidate: Callable[[bytes], None],
    replace: Callable[[bytes], None],
) -> None:
    verify_candidate(rendered)
    live, current_fingerprint = snapshot()
    if live != predecessor or current_fingerprint != expected_fingerprint:
        raise InstallRefused('Live Nginx configuration changed before recovery replacement')
    replace(rendered)

def rollback_if_current(
    predecessor: bytes,
    rendered: bytes,
    installed_fingerprint: Fingerprint,
    snapshot: Callable[[], Snapshot],
    verify_candidate: Callable[[bytes], None],
    replace: Callable[[bytes], None],
) -> bool:
    verify_candidate(predecessor)
    live, current_fingerprint = snapshot()
    if live != rendered or current_fingerprint != installed_fingerprint:
        return False
    replace(predecessor)
    return True

def snapshot(path: Path) -> Snapshot:
    before = path.stat()
    content = read_root_file(path, 262_144)
    after = path.stat()
    if fingerprint(before) != fingerprint(after):
        raise InstallRefused('Nginx configuration changed while reading')
    if after.st_uid != 0 or stat.S_IMODE(after.st_mode) != 0o400:
        raise InstallRefused('Nginx configuration metadata is unsafe')
    return content, fingerprint(after)

def command(*arguments: str) -> str:
    return subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=20).stdout.strip()

def direct_payment_status() -> int:
    result = subprocess.run(
        [
            '/usr/bin/curl', '--noproxy', '*', '-sS', '-o', '/dev/null', '-w',
            '%{http_code}', '--max-time', '2', '-X', 'POST',
            f'http://127.0.0.1:4897{PAYMENT_ROUTE}',
        ],
        capture_output=True,
        text=True,
        timeout=2.2,
    )
    if result.returncode or not re.fullmatch(r'[1-5][0-9]{2}', result.stdout):
        raise InstallRefused('Test-payment service probe was unavailable')
    return int(result.stdout)

def verify_runtime(server_hash: str) -> None:
    if command('/usr/bin/systemctl', 'is-active', SERVICE) != 'active':
        raise InstallRefused('Test-payment service is inactive')
    if command('/usr/bin/systemctl', 'show', SERVICE, '--property=FragmentPath', '--value') != str(SERVICE_PATH):
        raise InstallRefused('Test-payment service is not loaded from its reviewed unit')
    if read_root_file(SERVICE_PATH, 16384) != render_unit():
        raise InstallRefused('Test-payment service unit changed')
    if digest(read_root_file(ROOT / 'server.cjs', 2_000_000)) != server_hash:
        raise InstallRefused('Test-payment server payload changed')
    if direct_payment_status() != 401:
        raise InstallRefused('Test-payment service did not reject an unauthenticated request')
    if command('/usr/bin/systemctl', 'is-active', DEADLINE_TIMER) != 'active':
        raise InstallRefused('Test-payment deadline timer is inactive')
    if command('/usr/bin/systemctl', 'show', DEADLINE_TIMER, '--property=LoadState', '--value') != 'loaded':
        raise InstallRefused('Test-payment deadline timer is not loaded')
    if command('/usr/bin/systemctl', 'show', DEADLINE_TIMER, '--property=FragmentPath', '--value') != str(TIMER_PATH):
        raise InstallRefused('Test-payment deadline timer is not loaded from its reviewed unit')
    if TIMER_CALENDAR not in command('/usr/bin/systemctl', 'show', DEADLINE_TIMER, '--property=TimersCalendar', '--value'):
        raise InstallRefused('Test-payment deadline timer does not retain its fixed expiry')
    if read_root_file(TIMER_PATH, 8192) != render_deadline_units()[DEADLINE_TIMER]:
        raise InstallRefused('Test-payment deadline timer changed')
    verify_manual_artifact()

def route_statuses() -> list[tuple[str, str, int]]:
    rows = list(NEW_ROUTE_EXPECTATIONS)
    baseline = [*BASELINE_ROUTES, ('GET', GOALS_ROUTE)]
    for method, path in baseline:
        status = probe(method, path, 2)
        if status is None or method == 'GET' and status != 401:
            raise InstallRefused('Existing Nginx route probe was unhealthy')
        rows.append((method, path, status))
    return rows

def verify_routes(expected: list[tuple[str, str, int]]) -> None:
    actual = [(method, path, probe(method, path, 2)) for method, path, _ in expected]
    if actual != expected:
        raise InstallRefused('Nginx routes changed during recovery')

def wait_stable(
    expected: bytes,
    live_snapshot: Callable[[], Snapshot],
    check_routes: Callable[[], None],
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    duration: float = 15,
) -> None:
    deadline = clock() + duration
    while True:
        live, _ = live_snapshot()
        if live != expected:
            raise InstallRefused('Nginx configuration drifted after recovery')
        check_routes()
        remaining = deadline - clock()
        if remaining <= 0:
            return
        sleep(min(1, remaining))

def validate_state() -> os.stat_result:
    metadata = STATE_ROOT.stat()
    if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise InstallRefused('Test-payment recovery state is unsafe')
    predecessor_metadata = PREDECESSOR.stat()
    if predecessor_metadata.st_uid != 0 or stat.S_IMODE(predecessor_metadata.st_mode) != 0o400:
        raise InstallRefused('Nginx predecessor receipt metadata is unsafe')
    if CANDIDATE.exists() or CANDIDATE.is_symlink():
        raise InstallRefused('Nginx recovery candidate already exists')
    return metadata

def stage_candidate(rendered: bytes, metadata: os.stat_result) -> None:
    atomic_write(CANDIDATE, rendered, metadata, 0o400)
    verify_candidate(rendered)

def verify_candidate(rendered: bytes) -> None:
    if read_root_file(CANDIDATE, 262_144) != rendered:
        raise InstallRefused('Nginx recovery candidate changed while staging')

def replace_candidate(_: bytes) -> None:
    os.replace(CANDIDATE, NGINX_TARGET)
    descriptor = os.open(NGINX_TARGET.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)

def cleanup_candidate(rendered: bytes) -> None:
    if CANDIDATE.exists() and not CANDIDATE.is_symlink() and read_root_file(CANDIDATE, 262_144) == rendered:
        CANDIDATE.unlink()

def restore_if_current(
    predecessor: bytes, rendered: bytes, installed_fingerprint: Fingerprint, metadata: os.stat_result
) -> bool:
    stage_candidate(predecessor, metadata)
    try:
        return rollback_if_current(
            predecessor, rendered, installed_fingerprint, lambda: snapshot(NGINX_TARGET), verify_candidate, replace_candidate
        )
    finally:
        cleanup_candidate(predecessor)

@contextmanager
def recovery_lock():
    descriptor = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise InstallRefused('Nginx recovery lock is unsafe')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise InstallRefused('Nginx recovery is already in progress') from error
        yield
    finally:
        os.close(descriptor)

def reload() -> None:
    command('/usr/sbin/nginx', '-t')
    command('/usr/bin/systemctl', 'reload', 'nginx')

def recover(bundle: Path, manifest_digest: str, nginx_digest: str) -> dict[str, object]:
    if os.geteuid() != 0 or time.time() >= EXPIRY_EPOCH:
        raise InstallRefused('Root authority unavailable or expired')
    if nginx_digest != PREDECESSOR_SHA256:
        raise InstallRefused('Reviewed Nginx predecessor argument rejected')
    hashes, _, _, _ = load_bundle(bundle, manifest_digest)
    validate_state()
    with recovery_lock():
        state_metadata = validate_state()
        predecessor = read_root_file(PREDECESSOR, 262_144)
        validate_predecessor(predecessor)
        live, initial_fingerprint = snapshot(NGINX_TARGET)
        rendered = choose_target(predecessor, live)
        verify_runtime(hashes['server.cjs'])
        expected_routes = route_statuses()
        if live == rendered:
            wait_stable(rendered, lambda: snapshot(NGINX_TARGET), lambda: verify_routes(expected_routes))
            return receipt('already_active', rendered, expected_routes)
        stage_candidate(rendered, state_metadata)
        installed_fingerprint: Fingerprint | None = None
        try:
            replace_if_unchanged(
                predecessor, initial_fingerprint, rendered, lambda: snapshot(NGINX_TARGET),
                verify_candidate, replace_candidate,
            )
            installed, installed_fingerprint = snapshot(NGINX_TARGET)
            if installed != rendered:
                raise InstallRefused('Nginx recovery replacement did not install the candidate')
            reload()
            wait_for_routes(expected_routes)
            wait_stable(rendered, lambda: snapshot(NGINX_TARGET), lambda: verify_routes(expected_routes))
        except BaseException:
            if installed_fingerprint is not None and restore_if_current(
                predecessor, rendered, installed_fingerprint, state_metadata
            ):
                reload()
                wait_for_routes(expected_routes[len(NEW_ROUTE_EXPECTATIONS):])
            raise
        finally:
            cleanup_candidate(rendered)
        return receipt('repaired', rendered, expected_routes)

def receipt(status: str, rendered: bytes, routes: list[tuple[str, str, int]]) -> dict[str, object]:
    return {'status': status, 'diskSha256': digest(rendered), 'routeCount': len(ROUTES), 'baselineRouteCount': len(routes) - len(NEW_ROUTE_EXPECTATIONS), 'leaseExpiresAt': EXPIRES_AT, 'checkedAt': datetime.now(timezone.utc).isoformat()}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--bundle-manifest-sha256', required=True)
    parser.add_argument('--nginx-sha256', required=True)
    arguments = parser.parse_args()
    try:
        if not all(
            re.fullmatch(r'[0-9a-f]{64}', value)
            for value in (arguments.bundle_manifest_sha256, arguments.nginx_sha256)
        ):
            raise InstallRefused('Explicit reviewed recovery arguments required')
        print(
            json.dumps(
                recover(
                    arguments.bundle,
                    arguments.bundle_manifest_sha256,
                    arguments.nginx_sha256,
                ),
                separators=(',', ':'),
            )
        )
    except Exception:
        print('{"status":"refused","stage":"nginx-recovery"}', file=sys.stderr)
        raise SystemExit(1) from None
