#!/usr/bin/env python3
import argparse
import getpass
import hashlib
import json
import os
import pwd
import re
import stat
import subprocess
import sys
import time
import warnings
from pathlib import Path
from typing import List, Optional, Tuple

from install_contract import (
    ACCOUNT, CONFIG_ROOT, DATABASE_PASSWORD, DEADLINE_SERVICE, DEADLINE_TIMER,
    EXPIRES_AT, EXPIRY_EPOCH, PAYSTACK_SECRET, POSTGRES_CA, PUBLIC_CONFIG,
    ROOT, SERVICE, derive_runtime_config, render_deadline_units, render_unit, verify_payment_port,
)
from install_database import generate_password, has_topups, preflight, provision
from install_io import InstallRefused, atomic_write, create_service_root, load_bundle, read_root_file, write_secret
from install_recovery import begin, mark_database_started, mark_gateway_applied, recover_pre_activation, service_stopped


NGINX_TARGET = Path('/etc/nginx/sites-available/staging-auth.ogabassey.com')
STATE_ROOT = Path('/var/lib/baci-staging-test-payments')
NGINX_BACKUP = STATE_ROOT / 'nginx-predecessor.conf'
ROUTES = (
    ('/api/storefront/customer/wallet/top-up/initialize', 4897),
    ('/api/storefront/customer/wallet/top-up/confirm', 4897),
    ('/api/storefront/customer/savings/contributions/manual', 4795),
)
BASELINE_ROUTES = (
    ('GET', '/api/storefront/customer/wallet'),
    ('GET', '/api/storefront/customer/savings/drafts'),
    ('GET', '/api/storefront/customer/savings/notifications'),
    ('POST', '/piggyvest/intake'),
)
CURRENT_STAGE = 'startup'


def stage(value: str) -> None:
    global CURRENT_STAGE
    CURRENT_STAGE = value
def command(*arguments: str) -> str:
    return subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=20).stdout.strip()


def gateway(bundle: Path, mode: str) -> None:
    subprocess.run(
        ['/usr/bin/python3', str(bundle / 'gateway.py'), mode],
        check=True, capture_output=True, text=True, timeout=90,
    )


def render_nginx(content: bytes, expected_hash: str) -> bytes:
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise InstallRefused('Nginx predecessor hash drift')
    if b'include ' in content or any(route.encode() in content for route, _ in ROUTES):
        raise InstallRefused('Unexpected Nginx route or include')
    marker = b'location / {'
    if content.count(marker) != 1 or content.count(b'server_name staging-auth.ogabassey.com;') != 1:
        raise InstallRefused('Unexpected staging Nginx shape')
    blocks = b''.join(
        f'''\n    location = {route} {{\n        if ($request_method != POST) {{ return 405; }}\n        client_max_body_size 16k;\n        proxy_pass http://127.0.0.1:{port};\n        proxy_set_header Host staging.ogabassey.com;\n        proxy_set_header X-Forwarded-Host staging.ogabassey.com;\n        proxy_set_header X-Forwarded-Proto https;\n        proxy_set_header Forwarded \"\";\n        proxy_set_header x-middleware-subrequest \"\";\n        proxy_hide_header Cache-Control;\n        add_header Cache-Control \"no-store\" always;\n        access_log off;\n    }}\n'''.encode()
        for route, port in ROUTES
    )
    return content.replace(marker, blocks + b'    ' + marker, 1)


def probe(method: str, route: str, timeout: float) -> Optional[int]:
    curl_timeout = max(0.1, min(2, timeout))
    try:
        result = subprocess.run(['/usr/bin/curl', '--noproxy', '*', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', f'{curl_timeout:.3f}', '--resolve', 'staging-auth.ogabassey.com:443:127.0.0.1', '-X', method, f'https://staging-auth.ogabassey.com{route}'], capture_output=True, text=True, timeout=curl_timeout + 0.2)
        return int(result.stdout) if result.returncode == 0 and re.fullmatch(r'[1-5][0-9]{2}', result.stdout) else None
    except subprocess.SubprocessError:
        return None


def wait_for_routes(expected: List[Tuple[str, str, Optional[int]]]) -> None:
    deadline = time.monotonic() + 8
    consecutive = 0
    for _ in range(12):
        results: List[Optional[int]] = []
        for method, route, expected_status in expected:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise InstallRefused('Nginx readiness failed')
            results.append(probe(method, route, remaining))
        if results == [status for _, _, status in expected]:
            consecutive += 1
            if consecutive == 2:
                return
        else:
            consecutive = 0
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.25, remaining))
    raise InstallRefused('Nginx readiness failed')


def verify_manual_artifact() -> None:
    result = subprocess.run(['/usr/bin/curl', '--noproxy', '*', '-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '2', '-X', 'POST', '-H', 'Host: staging.ogabassey.com', 'http://127.0.0.1:4795/api/storefront/customer/savings/contributions/manual'], capture_output=True, text=True, timeout=2.2)
    if result.returncode or result.stdout != '401':
        raise InstallRefused('Existing manual contribution route is not ready')


def credential(path: Path, prefix: str, supplied: Optional[Path], prompt: str) -> None:
    if path.exists():
        value = read_root_file(path, 8192).decode()
    elif supplied is not None:
        value = read_root_file(supplied, 8192).decode()
    else:
        try:
            descriptor = os.open('/dev/tty', os.O_RDWR | os.O_NOCTTY)
        except OSError as error:
            raise InstallRefused('Interactive credential entry requires a controlling terminal') from error
        else:
            os.close(descriptor)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                value = getpass.getpass(prompt)
        except (EOFError, getpass.GetPassWarning) as error:
            raise InstallRefused('Interactive credential entry was not hidden') from error
    if value.endswith('\n'):
        value = value[:-1]
    if not value or value.strip() != value or '\x00' in value or not value.startswith(prefix):
        raise InstallRefused('Credential prefix rejected')
    write_secret(path, value)


def refuse_existing_installation() -> None:
    result = subprocess.run(['/usr/bin/systemctl', 'show', SERVICE, '--property=LoadState', '--value'], check=False, capture_output=True, text=True, timeout=10)
    if result.returncode == 0 and result.stdout.strip() != 'not-found':
        raise InstallRefused('Existing wallet test payment service refused')
    paths = [ROOT, STATE_ROOT, *(Path('/etc/systemd/system') / name for name in (SERVICE, DEADLINE_SERVICE, DEADLINE_TIMER))]
    if any(path.exists() or path.is_symlink() for path in paths):
        raise InstallRefused('Existing wallet test payment installation refused')


def save_nginx_backup(content: bytes) -> None:
    if NGINX_BACKUP.exists() or NGINX_BACKUP.is_symlink():
        raise InstallRefused('Nginx backup already exists')
    metadata = STATE_ROOT.stat()
    if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise InstallRefused('Nginx backup state is unsafe')
    atomic_write(NGINX_BACKUP, content, metadata, 0o400)


def verify_certificate_authority() -> None:
    certificate = read_root_file(POSTGRES_CA, 1_000_000)
    metadata = POSTGRES_CA.stat()
    if not certificate or stat.S_IMODE(metadata.st_mode) != 0o444:
        raise InstallRefused('PostgreSQL certificate authority is unsafe')


def stop_owned_service() -> None:
    subprocess.run(['/usr/bin/systemctl', 'stop', SERVICE], check=False, capture_output=True, text=True, timeout=20)
    subprocess.run(['/usr/bin/systemctl', 'disable', '--now', DEADLINE_TIMER], check=False, capture_output=True, text=True, timeout=20)
    result = subprocess.run(['/usr/bin/systemctl', 'show', SERVICE, '--property=ActiveState', '--property=LoadState'], check=False, capture_output=True, text=True, timeout=20)
    if not service_stopped(result.returncode, result.stdout):
        raise InstallRefused('Owned service did not stop')


def timer_is_active() -> bool:
    return command('/usr/bin/systemctl', 'is-active', DEADLINE_TIMER) == 'active'
def apply_gateway_after_timer(bundle: Path, manifest: str, server: bytes, nginx: str) -> None:
    if not timer_is_active():
        raise InstallRefused('Deadline timer did not become active')
    gateway(bundle, '--apply')
    mark_gateway_applied(STATE_ROOT, manifest, server, nginx)
def install(bundle: Path, manifest_digest: str, nginx_digest: str, paystack_source: Optional[Path] = None) -> dict[str, str]:
    if os.geteuid() != 0 or time.time() >= EXPIRY_EPOCH:
        raise InstallRefused('Root authority unavailable or expired')
    stage('bundle')
    hashes, declared, server, database = load_bundle(bundle, manifest_digest)
    public = derive_runtime_config(declared)
    verify_manual_artifact()
    units = {SERVICE: render_unit(), **render_deadline_units()}
    unit_paths = {Path('/etc/systemd/system') / name: content for name, content in units.items()}
    stage('recovery')
    if recover_pre_activation(STATE_ROOT, manifest_digest, server, nginx_digest, ROOT, unit_paths, has_topups, stop_owned_service):
        command('/usr/bin/systemctl', 'daemon-reload')
    refuse_existing_installation()
    verify_payment_port()
    stage('preflight')
    preflight(public)
    verify_certificate_authority()
    gateway(bundle, '--check')
    begin(STATE_ROOT, manifest_digest, server, nginx_digest)
    stage('materialize')
    nginx_content = read_root_file(NGINX_TARGET)
    nginx_metadata = NGINX_TARGET.stat()
    rendered = render_nginx(nginx_content, nginx_digest)
    previous_routes = [('POST', route, probe('POST', route, 2)) for route, _ in ROUTES]
    baseline = [(method, route, probe(method, route, 2)) for method, route in BASELINE_ROUTES]
    if any(status != 401 for method, _, status in baseline if method == 'GET'):
        raise InstallRefused('Existing customer routes are not healthy')
    account = pwd.getpwnam(ACCOUNT) if any(item.pw_name == ACCOUNT for item in pwd.getpwall()) else None
    if account is None:
        command('/usr/sbin/useradd', '--system', '--user-group', '--no-create-home', '--shell', '/usr/sbin/nologin', ACCOUNT)
        account = pwd.getpwnam(ACCOUNT)
    if account.pw_uid == 0:
        raise InstallRefused('Service account rejected')
    credential(PAYSTACK_SECRET, 'sk_test_', paystack_source, 'Paystack staging test secret: ')
    database_password = read_root_file(DATABASE_PASSWORD, 8192).decode() if DATABASE_PASSWORD.exists() else generate_password()
    write_secret(DATABASE_PASSWORD, database_password)
    root_metadata = create_service_root(ROOT)
    if root_metadata.st_uid != 0 or stat.S_IMODE(root_metadata.st_mode) != 0o755:
        raise InstallRefused('Service root is unsafe')
    config_metadata = CONFIG_ROOT.stat()
    if config_metadata.st_uid != 0 or config_metadata.st_mode & 0o022:
        raise InstallRefused('Runtime configuration root is unsafe')
    config_content = json.dumps(public, separators=(',', ':')).encode()
    if PUBLIC_CONFIG.exists() or PUBLIC_CONFIG.is_symlink():
        if read_root_file(PUBLIC_CONFIG) != config_content:
            raise InstallRefused('Runtime configuration already differs')
    else:
        atomic_write(PUBLIC_CONFIG, config_content, config_metadata, 0o444)
    for name, content in {'server.cjs': server}.items():
        target = ROOT / name
        atomic_write(target, content, root_metadata, 0o444)
    command('/usr/bin/node', '--check', str(ROOT / 'server.cjs'))
    stage('database')
    mark_database_started(STATE_ROOT, manifest_digest, server, nginx_digest)
    provision(database, public, database_password)
    rendered_unit_paths = []
    for target, content in unit_paths.items():
        metadata = target.parent.stat()
        atomic_write(target, content, metadata, 0o444)
        rendered_unit_paths.append(str(target))
    command('/usr/bin/systemd-analyze', 'verify', *rendered_unit_paths)
    command('/usr/bin/systemctl', 'daemon-reload')
    stage('service')
    command('/usr/bin/systemctl', 'start', SERVICE)
    if command('/usr/bin/systemctl', 'is-active', SERVICE) != 'active':
        stop_owned_service()
        raise InstallRefused('New wallet test payment service did not start')
    try:
        stage('deadline')
        command('/usr/bin/systemctl', 'enable', '--now', DEADLINE_TIMER)
        save_nginx_backup(nginx_content)
    except BaseException:
        stop_owned_service()
        raise
    try:
        stage('gateway')
        apply_gateway_after_timer(bundle, manifest_digest, server, nginx_digest)
    except BaseException:
        stop_owned_service()
        raise
    try:
        stage('nginx')
        atomic_write(NGINX_TARGET, rendered, nginx_metadata)
        command('/usr/sbin/nginx', '-t')
        command('/usr/bin/systemctl', 'reload', 'nginx')
        wait_for_routes([('POST', route, 401) for route, _ in ROUTES] + baseline)
    except BaseException as error:
        rollback_error: Optional[BaseException] = None
        try:
            atomic_write(NGINX_TARGET, nginx_content, nginx_metadata)
            command('/usr/sbin/nginx', '-t')
            command('/usr/bin/systemctl', 'reload', 'nginx')
            wait_for_routes(previous_routes + baseline)
        except BaseException as failure:
            rollback_error = failure
        finally:
            stop_owned_service()
        if rollback_error is not None:
            raise InstallRefused('Nginx activation and rollback failed') from rollback_error
        raise InstallRefused('Gateway transition applied; test-payments Nginx readiness failed') from error
    return {'serverSha256': hashes['server.cjs'], 'leaseExpiresAt': EXPIRES_AT, 'service': SERVICE}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--bundle-manifest-sha256', required=True)
    parser.add_argument('--nginx-sha256', required=True)
    parser.add_argument('--paystack-test-key-source', type=Path)
    options = parser.parse_args()
    if not options.install or not re.fullmatch(r'[0-9a-f]{64}', options.bundle_manifest_sha256) or not re.fullmatch(r'[0-9a-f]{64}', options.nginx_sha256):
        raise InstallRefused('Explicit reviewed install arguments required')
    print(json.dumps(install(options.bundle, options.bundle_manifest_sha256, options.nginx_sha256, options.paystack_test_key_source), separators=(',', ':')))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        print(json.dumps({'status': 'refused', 'stage': CURRENT_STAGE}, separators=(',', ':')), file=sys.stderr)
        raise SystemExit(1) from None
