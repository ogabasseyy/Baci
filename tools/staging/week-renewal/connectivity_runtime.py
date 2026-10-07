from datetime import datetime, timezone
import os
from pathlib import Path
import re
import stat
import subprocess
import time

from connectivity_contract import SERVICES, TIMERS, timer_schedule
from connectivity_listeners import validate_listeners
from connectivity_role import render_connectivity_role_script
from renewal_contract import PROTECTED_CONTAINERS, PROTECTED_SERVICES, PROTECTED_TIMERS, TARGET_EPOCH, Refused, parse_json
from renewal_owner import ENVIRONMENT, readonly_command


HERE = Path(__file__).resolve().parent
DOCKER_SQL = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'exec', '-i',
              'baci-isolated-savings-db-1', '/nix/var/nix/profiles/default/bin/psql',
              '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres']
HELPER = ['/usr/sbin/runuser', '-u', 'baci-savings-gateway', '-g', 'baci-savings-ingress', '--',
          '/usr/bin/sudo', '-n', '--', '/opt/baci-savings-gateway/managed-inventory-helper.mjs']
STOPPERS = tuple(name.replace('.timer', '.service') for name in TIMERS)
BASE_KEYS = ('LoadState', 'ActiveState', 'SubState', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload')
READ_PATHS = ('/api/storefront/customer/savings/drafts', '/api/storefront/customer/savings/goals',
              '/api/storefront/customer/savings/funding', '/api/storefront/customer/wallet')
PUBLIC_HOSTS = ('https://staging-auth.ogabassey.com', 'https://staging.ogabassey.com')


def command(arguments, content=None):
    allowed_units = set(SERVICES + TIMERS + STOPPERS + PROTECTED_SERVICES + PROTECTED_TIMERS)
    allowed = arguments == ['/usr/bin/systemctl', 'daemon-reload'] or arguments == HELPER
    allowed = allowed or arguments == ['/usr/bin/ss', '-H', '-ltnp', 'sport = :4792 or sport = :4795']
    if arguments[:2] in (['/usr/bin/systemctl', 'start'], ['/usr/bin/systemctl', 'stop']):
        allowed = bool(arguments[2:]) and set(arguments[2:]) <= set(SERVICES + TIMERS + STOPPERS)
    if arguments[:2] == ['/usr/bin/systemctl', 'show']:
        allowed = (len(arguments) == 4 and arguments[2] in allowed_units
                   and re.fullmatch(r'--property=[A-Za-z,]+', arguments[3]) is not None)
    if arguments == DOCKER_SQL:
        allowed = content in (render_connectivity_role_script(False).encode(), render_connectivity_role_script(True).encode())
    if arguments == ['/usr/bin/node', str(HERE / 'gateway-proof.mjs')]:
        allowed = isinstance(content, bytes) and len(content) <= 262144
    if not allowed or (content is not None and arguments not in (DOCKER_SQL, ['/usr/bin/node', str(HERE / 'gateway-proof.mjs')])):
        raise Refused('connectivity-command-scope')
    result = subprocess.run(arguments, input=content, capture_output=True, timeout=25, env=ENVIRONMENT)
    if result.returncode or len(result.stdout) > 1048576:
        raise Refused('connectivity-command')
    return result.stdout


def status(url, options=()):
    result = subprocess.run(['/usr/bin/curl', '-q', '--silent', '--show-error', '--max-time', '5',
                             '--output', '/dev/null', '--write-out', '%{http_code} %{content_type}', *options, url],
                            capture_output=True, timeout=7, env=ENVIRONMENT)
    matched = re.fullmatch(rb'([1-5][0-9]{2}) ([^\r\n]{0,160})', result.stdout)
    if result.returncode or matched is None:
        raise Refused('connectivity-http')
    code = int(matched[1])
    if code == 401 and matched[2].split(b';')[0].strip().lower() != b'application/json':
        raise Refused('connectivity-http-content-type')
    return code


def http(url):
    allowed = any(url == host + path for host in PUBLIC_HOSTS for path in READ_PATHS + ('/auth/v1/user', '/piggyvest/intake'))
    allowed = allowed or any(url == f'http://127.0.0.1:{port}' + path
                             for port in (4792, 4795) for path in READ_PATHS)
    if not allowed:
        raise Refused('connectivity-http-scope')
    return status(url)


def socket_http():
    code = status('http://staging-auth.ogabassey.com/auth/v1/user',
                  ('--unix-socket', '/run/baci-savings-gateway/ingress.sock'))
    if code != 401:
        raise Refused('connectivity-socket-http')


def effective_stop(value, expected):
    matches = re.findall(r'argv\[\]=([^;]+)\s*;', value)
    if (len(matches) != 1 or matches[0].split() != expected
            or value.count('ignore_errors=no') != 1 or 'ignore_errors=yes' in value):
        raise Refused('deadline-effective-stop')


def show(name, extra=(), pending_reload=False):
    output = command(['/usr/bin/systemctl', 'show', name, '--property=' + ','.join(BASE_KEYS + extra)])
    result = dict(line.split('=', 1) for line in output.decode().splitlines() if '=' in line)
    if (set(result) != set(BASE_KEYS + extra) or result['LoadState'] != 'loaded'
            or result['FragmentPath'] != '/etc/systemd/system/' + name
            or result['DropInPaths'] or result['NeedDaemonReload'] not in (('no', 'yes') if pending_reload else ('no',))):
        raise Refused('connectivity-effective-unit')
    return result


def protected_stopped():
    for name in PROTECTED_SERVICES + PROTECTED_TIMERS:
        extra = ('MainPID',) if name.endswith('.service') else ()
        value = show(name, extra)
        if value['ActiveState'] not in ('inactive', 'failed') or extra and value['MainPID'] != '0':
            raise Refused('connectivity-financial-runtime-active')
    for name in PROTECTED_CONTAINERS:
        content = readonly_command(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'inspect', '--format',
                                    '{{json .State.Running}} {{json .State.Restarting}} {{json .HostConfig.RestartPolicy}}', name])
        if content.strip() != 'false false {"Name":"no","MaximumRetryCount":0}':
            raise Refused('connectivity-financial-runtime-active')


class Runtime:
    def stop(self):
        command(['/usr/bin/systemctl', 'stop', 'baci-savings-funding.service'])
        command(['/usr/bin/systemctl', 'stop', *SERVICES, *TIMERS, *STOPPERS])
        for name in SERVICES:
            value = show(name, ('MainPID',), pending_reload=True)
            if value['ActiveState'] not in ('inactive', 'failed') or value['MainPID'] != '0':
                raise Refused('connectivity-stop-unconfirmed')
        protected_stopped()

    def role_sql(self, commit):
        return parse_json(command(DOCKER_SQL, render_connectivity_role_script(commit).encode()))

    def reload(self):
        command(['/usr/bin/systemctl', 'daemon-reload'])

    def deadlines(self, expected):
        for name, arguments in expected.items():
            effective_stop(show(name, ('ExecStart',))['ExecStart'], arguments)
        command(['/usr/bin/systemctl', 'start', *TIMERS])
        for name in TIMERS:
            value = show(name, ('Unit', 'NextElapseUSecRealtime', 'AccuracyUSec', 'RandomizedDelayUSec'))
            timer_schedule(value, name.replace('.timer', '.service'))

    def inventory(self):
        return parse_json(command(HELPER))

    def check_gateway(self, content):
        value = parse_json(command(['/usr/bin/node', str(HERE / 'gateway-proof.mjs')], content))
        if value != {'valid': True, 'expiresAt': '2026-10-06T15:59:10.442Z'}:
            raise Refused('connectivity-gateway-proof')

    def start(self):
        for name in SERVICES:
            if int(time.time()) + 60 >= TARGET_EPOCH:
                raise Refused('connectivity-deadline-near')
            command(['/usr/bin/systemctl', 'start', name])

    def verify(self, ingress_uid, ingress_gid):
        processes = {}
        for name in SERVICES:
            value = show(name, ('MainPID', 'Restart', 'KillMode', 'RuntimeMaxUSec'))
            if (value['ActiveState'] != 'active' or value['SubState'] != 'running'
                    or not value['MainPID'].isdigit() or int(value['MainPID']) <= 0
                    or value['Restart'] != 'no' or value['KillMode'] != 'control-group'
                    or value['RuntimeMaxUSec'] != '1w'):
                raise Refused('connectivity-service-health')
            if name != SERVICES[0]:
                processes[4792 if name == SERVICES[1] else 4795] = int(value['MainPID'])
        checks = {}
        targets = [(f'http://127.0.0.1:{port}' + path, 401) for port, path in (
            (4792, READ_PATHS[0]), (4795, READ_PATHS[1]), (4795, READ_PATHS[2]), (4795, READ_PATHS[3]))]
        targets += [(host + path, 401) for host in PUBLIC_HOSTS for path in READ_PATHS]
        targets += [(PUBLIC_HOSTS[0] + '/auth/v1/user', 401)]
        for url, expected in targets:
            deadline = time.monotonic() + 15
            while True:
                try:
                    actual = http(url)
                except Refused:
                    actual = 0
                if actual == expected:
                    checks[url] = actual
                    break
                if time.monotonic() >= deadline:
                    raise Refused('connectivity-route-health')
                time.sleep(0.25)
        validate_listeners(command(['/usr/bin/ss', '-H', '-ltnp', 'sport = :4792 or sport = :4795']).decode(), processes)
        socket = Path('/run/baci-savings-gateway/ingress.sock').lstat()
        if (not stat.S_ISSOCK(socket.st_mode) or socket.st_uid != ingress_uid or socket.st_gid != ingress_gid
                or stat.S_IMODE(socket.st_mode) != 0o660):
            raise Refused('connectivity-socket')
        socket_http()
        protected_stopped()
        if time.time() + 30 >= TARGET_EPOCH:
            raise Refused('connectivity-deadline-near')
        for name in SERVICES:
            value = show(name, ('MainPID',))
            if value['ActiveState'] != 'active' or value['SubState'] != 'running' or int(value['MainPID']) <= 0:
                raise Refused('connectivity-service-health')
        return checks
