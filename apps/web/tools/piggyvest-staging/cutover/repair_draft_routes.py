import hashlib
import json
import os
import ssl
import stat
import subprocess
import time
import types
import urllib.error
import urllib.request
from pathlib import Path


INSTALLER = Path('/opt/baci-savings-drafts/installer/install-customer-draft-routes.py')
PIN = '6f23bd6dd2276dc1cbb762426556ede964f75ee62028352e9402b4930fc72d9c'
ORIGIN = 'https://staging-auth.ogabassey.com'
BASE = '/api/storefront/customer/savings/drafts'
STAGE = 'initialization'


def report_stage(value):
    global STAGE
    STAGE = value


def load_installer():
    report_stage('installer-open')
    descriptor = os.open(INSTALLER, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as source:
        metadata = os.fstat(source.fileno())
        content = source.read()
    report_stage('installer-integrity')
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
            or metadata.st_mode & 0o022 or hashlib.sha256(content).hexdigest() != PIN):
        raise RuntimeError('installer-pin')
    module = types.ModuleType('reviewed_nginx_installer')
    report_stage('installer-load')
    exec(compile(content, str(INSTALLER), 'exec'), module.__dict__)
    return module


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def status(route, method='GET'):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                       urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request(ORIGIN + route, method=method, headers={
        'User-Agent': 'Baci-Staging-Healthcheck/1.0 (Python urllib; owner-authorized staging verification)',
    })
    try:
        with opener.open(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def repair(installer):
    report_stage('nginx-read')
    original, metadata = installer.read_target()
    pin = hashlib.sha256(original).hexdigest()
    report_stage('nginx-render')
    candidate = installer.render_config(original, pin)
    report_stage('auth-health-preflight')
    if status('/auth/v1/user') != 401:
        raise RuntimeError('existing-auth-health')
    installer.unchanged(original, metadata)
    report_stage('nginx-backup')
    backup = installer.make_backup(original, metadata)
    installer.unchanged(original, metadata)
    stage = 'write-and-reload'
    try:
        installer.atomic_write(candidate, backup, metadata)
        installer.validate_reload()
        stable = 0
        observed = []
        for attempt in range(60):
            stage = 'persistent-config'
            report_stage(stage)
            if installer.read_target()[0] != candidate:
                raise RuntimeError('configuration-changed')
            stage = 'public-route-health'
            report_stage(stage)
            observed = []
            for route in (BASE, BASE + '/policy', BASE + '/catalogue'):
                observed.append({'route': route, 'get': status(route), 'put': status(route, 'PUT')})
            if status('/auth/v1/user') != 401:
                raise RuntimeError('auth-health')
            if all(result['get'] == 401 and result['put'] == 405 for result in observed):
                stable += 1
                if stable == 3:
                    break
                time.sleep(5)
            else:
                stable = 0
                time.sleep(1)
        else:
            print(json.dumps({'stage': stage, 'responses': observed}))
            raise RuntimeError('route-health')
        print(json.dumps({'stage': 'draft-nginx-routes', 'status': 'verified',
                          'unauthenticated': 401, 'wrongMethod': 405}))
    except Exception:
        restored = False
        if installer.read_target()[0] == candidate:
            installer.atomic_write(original, backup, metadata)
            installer.validate_reload()
            restored = True
        print(json.dumps({'stage': stage, 'status': 'failed',
                          'originalRestored': restored, 'redacted': True}))
        raise


def main():
    try:
        report_stage('root-and-lease')
        if os.geteuid() != 0 or time.time() >= 1789989845:
            raise RuntimeError('expired-or-not-root')
        report_stage('draft-service-health')
        subprocess.run(['/usr/bin/systemctl', 'is-active', '--quiet', 'baci-savings-drafts.service'],
                       check=True, timeout=10, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        repair(load_installer())
        return 0
    except Exception as error:
        print(json.dumps({'stage': STAGE, 'errorType': type(error).__name__,
                          'errno': getattr(error, 'errno', None), 'redacted': True}))
        print('Route repair refused or failed. No service restart or lease extension performed.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
