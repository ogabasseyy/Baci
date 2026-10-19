import json
import os
import pwd
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


SERVICE = 'baci-savings-drafts.service'
SMOKE = 'baci-savings-drafts-smoke.service'
TIMER = 'baci-savings-drafts-deadline.timer'
UNITS = (SERVICE, SMOKE, TIMER, 'baci-savings-drafts-deadline.service')
ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}


def command(arguments):
    return subprocess.run(arguments, check=True, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          timeout=45, env=ENV, text=True).stdout.strip()


def probe(port):
    request = urllib.request.Request(
        f'http://127.0.0.1:{port}/api/storefront/customer/savings/drafts',
        headers={'Host': 'staging.ogabassey.com',
                 'X-Forwarded-Host': 'staging.ogabassey.com',
                 'X-Forwarded-Proto': 'https'})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=3) as response:
            return response.status == 401
    except urllib.error.HTTPError as error:
        return error.code == 401
    except (OSError, urllib.error.URLError):
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def wait_ready(unit, port):
    for attempt in range(30):
        state = command(['/usr/bin/systemctl', 'show', unit, '-p', 'ActiveState', '--value'])
        if state == 'failed':
            raise RuntimeError('service-start')
        if state == 'active' and probe(port):
            listeners = command(['/usr/bin/ss', '-ltnH', f'( sport = :{port} )']).splitlines()
            if len(listeners) != 1 or listeners[0].split()[3] != f'127.0.0.1:{port}':
                raise RuntimeError('listener-binding')
            return
        time.sleep(1)
    raise RuntimeError('service-health')


def stop_legacy():
    import re
    listeners = command(['/usr/bin/ss', '-ltnpH', '( sport = :4792 )']).splitlines()
    if len(listeners) != 1 or listeners[0].split()[3] != '127.0.0.1:4792':
        raise RuntimeError('legacy-listener')
    identifiers = set(re.findall(r'pid=(\d+)', listeners[0]))
    if len(identifiers) != 1:
        raise RuntimeError('legacy-identity')
    identifier = int(identifiers.pop())
    descriptor = os.pidfd_open(identifier)
    try:
        process = Path(f'/proc/{identifier}')
        expected = '/home/bassey/baci-drafts-build-20260920/apps/web/.next/standalone/apps/web'
        if (process.stat().st_uid != pwd.getpwnam('bassey').pw_uid
                or os.readlink(process / 'exe') != '/usr/bin/node'
                or os.readlink(process / 'cwd') != expected):
            raise RuntimeError('legacy-identity')
        signal.pidfd_send_signal(descriptor, signal.SIGTERM)
        for attempt in range(20):
            if not command(['/usr/bin/ss', '-ltnH', '( sport = :4792 )']):
                return
            time.sleep(1)
        raise RuntimeError('legacy-stop')
    finally:
        os.close(descriptor)


def preflight_units(directory):
    for name in UNITS:
        if os.path.lexists(directory / name):
            raise RuntimeError('existing-unit')
    for port in (4794,):
        if command(['/usr/bin/ss', '-ltnH', f'( sport = :{port} )']):
            raise RuntimeError('smoke-port-in-use')


def activate(installer, config_hash):
    stage = 'unit-validation'
    try:
        command(['/usr/bin/systemd-analyze', 'verify',
                 *[str(installer.UNIT_DIRECTORY / name) for name in UNITS]])
        command(['/usr/bin/systemctl', 'daemon-reload'])
        stage = 'sandbox-smoke'
        command(['/usr/bin/systemctl', 'start', SMOKE])
        try:
            wait_ready(SMOKE, 4794)
        finally:
            command(['/usr/bin/systemctl', 'stop', SMOKE])
        stage = 'deadline'
        installer.require_root_and_time()
        command(['/usr/bin/systemctl', 'enable', '--now', TIMER])
        command(['/usr/bin/systemctl', 'is-active', '--quiet', TIMER])
        stage = 'legacy-stop'
        stop_legacy()
        stage = 'service-start'
        command(['/usr/bin/systemctl', 'start', SERVICE])
        wait_ready(SERVICE, 4792)
        stage = 'nginx'
        root_installer = installer.DESTINATION / 'installer/install-customer-draft-routes.py'
        command(['/usr/bin/python3', '-I', str(root_installer),
                 '--install', '--expected-sha256', config_hash])
        print(json.dumps({'stage': 'staging-cutover', 'status': 'active',
                          'expiresAt': '2026-09-21T11:24:05Z'}))
    except Exception:
        for unit in (SMOKE, SERVICE):
            try:
                command(['/usr/bin/systemctl', 'stop', unit])
            except Exception:
                pass
        print(json.dumps({'stage': stage, 'status': 'failed', 'redacted': True}))
        raise
