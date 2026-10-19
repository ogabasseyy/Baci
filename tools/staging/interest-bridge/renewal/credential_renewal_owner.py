import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys


SQL_PIN = '38d1ee5a5d0e4f7b46eb1c6ddc41b97a0bd9577ef8b053455c1bdb64cac6d4b8'
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
DATABASE = [*DOCKER, 'exec', '-i', 'baci-isolated-savings-db-1',
            '/nix/var/nix/profiles/default/bin/psql', '-XqAt', '-U', 'postgres', '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']
CONTAINERS = ('pvb-staging-replay-prefunded', 'pvb-staging-replay-prefunded-check',
              'baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot')
SERVICES = ('baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot',
            'baci-staging-test-payments', 'baci-savings-notifications')


def render_sql(content, apply=False):
    if hashlib.sha256(content).hexdigest() != SQL_PIN:
        raise ValueError('Reviewed SQL pin differs')
    source = content.decode('utf-8')
    if source.count('__FINISH__') != 1 or source.count('BEGIN;') != 1:
        raise ValueError('Reviewed SQL framing differs')
    return source.replace('__FINISH__', 'COMMIT;' if apply else 'ROLLBACK;')


def command(arguments, input_text=None):
    result = subprocess.run(arguments, input=input_text, text=True, capture_output=True,
                            timeout=40, env=ENVIRONMENT)
    if result.returncode or len(result.stdout) > 131072:
        raise ValueError('Reviewed command refused')
    return result.stdout


def stopped_runtimes():
    containers = json.loads(command([*DOCKER, 'inspect', *CONTAINERS]))
    if len(containers) != len(CONTAINERS):
        raise ValueError('Financial runtime inventory refused')
    for value, expected in zip(containers, CONTAINERS):
        state = value.get('State', {})
        if (value.get('Name') != '/' + expected or state.get('Running') is not False
                or state.get('Paused') is not False or state.get('Restarting') is not False
                or state.get('Status') not in ('created', 'exited')
                or value.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') != 'no'):
            raise ValueError('Financial runtime must stay stopped')
    for service in SERVICES:
        state = command(['/usr/bin/systemctl', 'show', service + '.service',
                         '--property=ActiveState', '--value']).strip()
        if state not in ('inactive', 'failed'):
            raise ValueError('Financial service must stay stopped')


def read_source(directory):
    if directory.parent != Path('/root'):
        raise ValueError('Root-private bundle required')
    for parent in (Path('/root'), directory):
        metadata = parent.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o077:
            raise ValueError('Root-private bundle required')
    descriptor = os.open(directory / 'credential-renewal.sql', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        metadata = os.fstat(handle.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_gid != 0
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1
                or not 0 < metadata.st_size < 32768):
            raise ValueError('Reviewed SQL metadata refused')
        return handle.read(32768)


def main():
    applied = False
    stage = 'preflight'
    try:
        if os.geteuid() != 0 or sys.argv[1:] not in (['--rehearse'], ['--apply']):
            raise ValueError('Explicit owner mode required')
        apply = sys.argv[1:] == ['--apply']
        directory = Path(__file__).absolute().parent
        source = render_sql(read_source(directory), apply)
        stopped_runtimes()
        stage = 'database-apply-unconfirmed' if apply else 'rollback-rehearsal'
        applied = None if apply else False
        command(DATABASE, source)
        applied = apply
        stage = 'independent-verification'
        expiry = command(DATABASE, "BEGIN READ ONLY; SELECT rolvaliduntil=TIMESTAMPTZ '"
                         + ('2026-10-06T15:59:10Z' if apply else '2026-09-29T15:59:10Z')
                         + "' FROM pg_roles WHERE rolname='prefunded_treasury_operator'; ROLLBACK;").strip()
        if expiry != 't':
            raise ValueError('Credential deadline verification refused')
        stopped_runtimes()
        report = dict(status='interest-credential-renewed-inactive' if apply else 'rehearsal-rolled-back',
                      databaseApplied=applied, expiresAt='2026-10-06T15:59:10Z', servicesStarted=False,
                      permissionsChanged=False, passwordChanged=False, balancesChanged=False,
                      bridgeAccessGranted=False, payoutAllocationCreated=False, replayReady=False)
        descriptor = os.open(directory / ('renewal-result.json' if apply else 'rehearsal-result.json'),
                             os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            handle.write(json.dumps(report) + '\n')
            handle.flush()
            os.fsync(handle.fileno())
    except Exception:
        print(json.dumps(dict(status='refused', stage=stage, databaseApplied=applied,
                              servicesStarted=False, replayReady=False, redacted=True)))
        return 1
    print(json.dumps(report))
    return 0


if __name__ == '__main__':
    sys.exit(main())
