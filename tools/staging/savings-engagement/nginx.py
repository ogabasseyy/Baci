import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time


HELPER_HASH = '84bd7fbf8160ca7281939886040d78665b54a2f1700712ebfb09931503f2084d'
HOST = b'staging-auth.ogabassey.com'
NOTIFICATIONS = b'/api/storefront/customer/savings/notifications'
TOKEN = re.compile(rb'''\s+|\#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};"'\#]+''')
LOCATION = b'''    location = /api/storefront/customer/savings/notifications {
        if ($request_method !~ ^(GET|PATCH)$) { return 405; }
        client_max_body_size 16k;
        proxy_pass http://127.0.0.1:4795;
        proxy_set_header Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Host staging.ogabassey.com;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header x-middleware-subrequest "";
        proxy_hide_header Cache-Control;
        add_header Cache-Control "no-store" always;
        access_log off;
    }
'''


class ActivationFailure(RuntimeError):
    def __init__(self, report):
        super().__init__('Nginx activation did not pass verification')
        self.report = report


def wait_for_routes(expectations):
    consecutive = 0
    deadline = time.monotonic() + 8
    for attempt in range(12):
        checks = []
        for method, route, expected in expectations:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ActivationFailure({'phase': 'route-readiness', 'checks': checks, 'deadlineReached': True})
            try:
                actual = probe(method, route, timeout=min(2, remaining))
            except (OSError, RuntimeError, subprocess.SubprocessError):
                actual = None
            checks.append({'method': method, 'path': route, 'expected': expected, 'actual': actual})
        if all(check['actual'] == check['expected'] for check in checks):
            consecutive += 1
            if consecutive == 2:
                return
        else:
            consecutive = 0
        if attempt == 0:
            print(json.dumps({'stage': 'nginx-readiness', 'checks': checks}), flush=True)
        if attempt < 11:
            time.sleep(max(0, min(0.25, deadline - time.monotonic())))
    raise ActivationFailure({'phase': 'route-readiness', 'checks': checks})


def render(content, expected_hash):
    if hashlib.sha256(content).hexdigest() != expected_hash:
        raise RuntimeError('Nginx predecessor hash drift')
    already_installed = content.count(LOCATION) == 1
    baseline = content.replace(LOCATION, b'') if already_installed else content
    tokens, offset = [], 0
    for match in TOKEN.finditer(baseline):
        if match.start() != offset:
            raise RuntimeError('Invalid Nginx token')
        offset = match.end()
        value = match.group()
        if not value.isspace() and not value.startswith(b'#'):
            tokens.append((value, match.start()))
    if offset != len(baseline):
        raise RuntimeError('Incomplete Nginx token')
    stack, directive, hosts, servers = [], [], [], []
    for value, position in tokens:
        plain = value.strip(b'"\'')
        if NOTIFICATIONS in plain or plain == b'include':
            raise RuntimeError('Unreviewed notification route or include')
        if value == b'{':
            stack.append((tuple(directive), position))
            directive = []
        elif value == b';':
            if directive and directive[0] == b'server_name':
                if directive != [b'server_name', HOST] or len(stack) != 1:
                    raise RuntimeError('Unexpected Nginx host')
                hosts.append(stack[0][1])
            directive = []
        elif value == b'}':
            if not stack or directive:
                raise RuntimeError('Invalid Nginx block')
            block, opening = stack.pop()
            if block == (b'server',) and not stack:
                servers.append((opening, position))
        else:
            directive.append(plain)
    if stack or directive or len(hosts) != 1 or len(servers) != 1:
        raise RuntimeError('Unexpected Nginx server count')
    opening, closing = servers[0]
    if opening != hosts[0] or tokens[-1] != (b'}', closing):
        raise RuntimeError('Unexpected Nginx server boundary')
    return content if already_installed else baseline[:closing] + LOCATION + baseline[closing:]


def helpers():
    source = Path(__file__).with_name('install-customer-funding-routes.py')
    content = source.read_bytes()
    if hashlib.sha256(content).hexdigest() != HELPER_HASH:
        raise RuntimeError('Nginx helper hash drift')
    specification = importlib.util.spec_from_file_location('engagement_nginx_helpers', source)
    module = importlib.util.module_from_spec(specification)
    exec(compile(content, str(source), 'exec'), module.__dict__)
    return module


def probe(method, path, timeout=2):
    result = subprocess.run([
        '/usr/bin/curl', '-sS', '-o', '/dev/null', '-w', '%{http_code}',
        '--max-time', str(timeout), '--resolve', f'{HOST.decode()}:443:127.0.0.1',
        '-X', method, f'https://{HOST.decode()}{path}',
    ], check=True, capture_output=True, text=True, timeout=timeout + 0.2)
    if not re.fullmatch(r'[1-5][0-9]{2}', result.stdout):
        raise RuntimeError('Invalid Nginx probe')
    return int(result.stdout)


def install(expected_hash, check=False):
    if os.geteuid() != 0:
        raise RuntimeError('Owner root execution required')
    helper = helpers()
    content, metadata = helper.read_target()
    rendered = render(content, expected_hash)
    baseline = {path: probe('GET', path) for path in (
        '/api/storefront/customer/wallet', '/api/storefront/customer/savings/goals',
        '/api/storefront/customer/savings/drafts', '/piggyvest/intake',
    )}
    if any(status != 401 for path, status in baseline.items() if path != '/piggyvest/intake'):
        raise RuntimeError('Existing customer service is not healthy')
    if check:
        return {'status': 'checked', 'sha256': expected_hash}
    original_routes = [('GET', path, status) for path, status in baseline.items()]
    original_routes.extend((method, NOTIFICATIONS.decode(), probe(method, NOTIFICATIONS.decode()))
                           for method in ('GET', 'PATCH', 'POST'))
    helper.unchanged(content, metadata)
    backup = helper.make_backup(content, metadata)
    phase = 'configuration-write'
    try:
        helper.unchanged(content, metadata)
        helper.atomic_write(rendered, backup, metadata)
        phase = 'configuration-test-and-reload'
        helper.validate_reload()
        phase = 'route-readiness'
        wait_for_routes([(method, NOTIFICATIONS.decode(), expected)
                         for method, expected in (('GET', 401), ('PATCH', 401), ('POST', 405))]
                        + [('GET', path, status) for path, status in baseline.items()])
    except Exception as error:
        report = dict(error.report) if isinstance(error, ActivationFailure) else {'phase': phase, 'errorType': type(error).__name__}
        report['backup'] = str(backup)
        try:
            current, _ = helper.read_target()
            if current != rendered:
                raise RuntimeError('Nginx drift during rollback')
            helper.atomic_write(content, backup, metadata)
            helper.validate_reload()
            wait_for_routes(original_routes)
            report['rollback'] = 'verified'
        except Exception:
            report['rollback'] = 'not-verified'
        raise ActivationFailure(report) from None
    return {'status': 'active', 'backup': str(backup), 'sha256': hashlib.sha256(rendered).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.expected_sha256, args.check)))
    except Exception as error:
        print(json.dumps({'status': 'refused', 'errorType': type(error).__name__,
                          'nginx': error.report if isinstance(error, ActivationFailure) else None}))
        raise SystemExit(1) from None
