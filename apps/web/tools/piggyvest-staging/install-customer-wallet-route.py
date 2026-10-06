import argparse
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import time

ROUTES_PATH = Path(__file__).with_name('customer-wallet-routes.py')
ROUTES_SPEC = importlib.util.spec_from_file_location('customer_wallet_routes', ROUTES_PATH)
if ROUTES_SPEC is None or ROUTES_SPEC.loader is None:
    raise RuntimeError('Could not load customer wallet route configuration.')
ROUTES = importlib.util.module_from_spec(ROUTES_SPEC)
ROUTES_SPEC.loader.exec_module(ROUTES)
HELPERS = ROUTES.HELPERS
render_config = ROUTES.render_config
STAGING_HOST = 'staging-auth.ogabassey.com'
INTAKE_PATH = '/piggyvest/intake'
DRAFTS_PATH = '/api/storefront/customer/savings/drafts'
WALLET_PATH = '/api/storefront/customer/wallet'


Refused = HELPERS.Refused


def probe_status(method, path, timeout=8):
    request_timeout = max(0.1, min(float(timeout), 8))
    result = subprocess.run(
        [
            '/usr/bin/curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
            '--max-time', str(request_timeout), '--resolve', f'{STAGING_HOST}:443:127.0.0.1',
            '-X', method, f'https://{STAGING_HOST}{path}',
        ],
        check=True,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=request_timeout + 0.5,
        env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'},
    )
    if not re.fullmatch(r'[1-5][0-9]{2}', result.stdout):
        raise Refused('Staging route health probe failed.')
    return int(result.stdout)


def verify_routes(intake_baseline):
    deadline = time.monotonic() + 10
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Refused('Wallet startup health probes did not converge.')
        get_status = probe_status('GET', WALLET_PATH, remaining)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Refused('Wallet startup health probes did not converge.')
        post_status = probe_status('POST', WALLET_PATH, remaining)
        if get_status == 401 and post_status == 405:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Refused('Wallet startup health probes did not converge.')
        time.sleep(min(0.25, remaining))

    if probe_status('GET', DRAFTS_PATH) != 401:
        raise Refused('Existing savings drafts route health probe failed.')
    intake_after = (
        probe_status('GET', INTAKE_PATH),
        probe_status('POST', INTAKE_PATH),
    )
    if intake_after != intake_baseline:
        raise Refused('Existing staging intake behavior changed.')


def install(expected_sha256):
    if os.geteuid() != 0 or os.getuid() != 0:
        raise Refused()
    content, metadata = HELPERS.read_target()
    rendered = render_config(content, expected_sha256)
    intake_baseline = (
        probe_status('GET', INTAKE_PATH),
        probe_status('POST', INTAKE_PATH),
    )
    HELPERS.unchanged(content, metadata)
    backup = HELPERS.make_backup(content, metadata)
    HELPERS.unchanged(content, metadata)
    try:
        HELPERS.atomic_write(rendered, backup, metadata)
        HELPERS.validate_reload()
        verify_routes(intake_baseline)
    except Exception:
        try:
            current, _ = HELPERS.read_target()
            if current != rendered:
                raise Refused()
            HELPERS.atomic_write(backup.read_bytes(), backup, metadata)
            HELPERS.validate_reload()
        except Exception:
            raise Refused('Install failed; rollback requires operator attention.') from None
        raise Refused('Install failed; original configuration restored.') from None


def main():
    parser = argparse.ArgumentParser(description='Install the staging customer wallet nginx route.')
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--install', action='store_true', required=True)
    arguments = parser.parse_args()
    try:
        install(arguments.expected_sha256)
    except Refused as error:
        print(str(error) or 'Installation refused.')
        return 1
    except Exception:
        print('Installation failed.')
        return 1
    print('Staging customer wallet route installed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
