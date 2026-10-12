import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys


MIGRATION_NAME = '20261001230000_customer_savings_interest_policy.sql'
MIGRATION_PIN = '22bf2761b6d3db6bf367bd867e9f00b75acfcacec22af864a73fa564a65813b8'
GUARD_PIN = 'eeea5e6a9e55e5178f09913a2084186c739fbb5674e1602a93976135d63fa47e'
FUNCTIONS = {
    'piggyvest_savings_ledger.guard_interest_policy': ('', False),
    'piggyvest_savings_ledger.prepare_interest_allocation': ('uuid,text,jsonb', True),
    'piggyvest_savings_ledger.apply_interest_receipt': ('uuid,text,text,jsonb,text', True),
    'public.get_customer_savings_earnings': ('uuid,boolean', True),
}
DATABASE = ['/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1',
            'psql', '-XqAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
SERVICES = ('baci-prefunded-public', 'baci-prefunded-background',
            'baci-prefunded-snapshot', 'baci-staging-test-payments')
CONTAINERS = ('pvb-staging-replay-prefunded', 'pvb-staging-replay-prefunded-check',
              'baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot')
ENVIRONMENT = dict(HOME='/root', PATH='/usr/sbin:/usr/bin:/sbin:/bin', LANG='C', LC_ALL='C')


def render_sql(migration, guard, apply=False):
    if (hashlib.sha256(migration).hexdigest() != MIGRATION_PIN
            or hashlib.sha256(guard.encode()).hexdigest() != GUARD_PIN):
        raise ValueError('Reviewed policy bytes differ')
    source = migration.decode().strip()
    if not source.startswith('BEGIN;') or not source.endswith('COMMIT;'):
        raise ValueError('Policy transaction framing differs')
    body = source[len('BEGIN;'):-len('COMMIT;')]
    if 'COMMIT;' in body or 'ROLLBACK;' in body or '\\' in body:
        raise ValueError('Policy transaction escape refused')
    definitions = re.findall(r'CREATE OR REPLACE FUNCTION ([\w.]+)\(.*?AS \$\$(.*?)\$\$;', body, re.S)
    if len(definitions) != len(FUNCTIONS) or {name for name, definition in definitions} != set(FUNCTIONS):
        raise ValueError('Reviewed policy function set differs')
    pins = []
    for name, definition in definitions:
        arguments, definer = FUNCTIONS[name]
        pins.append(f"('{name}({arguments})','{hashlib.md5(definition.encode()).hexdigest()}',"
                    f"{'true' if definer else 'false'})")
    for marker in ('__MIGRATION__', '__FUNCTION_PINS__', '__FINISH__'):
        if guard.count(marker) != 1:
            raise ValueError('Policy guard marker differs')
    return guard.replace('__MIGRATION__', body).replace('__FUNCTION_PINS__', ','.join(pins)).replace(
        '__FINISH__', 'COMMIT;' if apply else 'ROLLBACK;')


def protected_read(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600 or not 0 < info.st_size <= 65536):
            raise ValueError('Unsafe root-reviewed policy input')
        with os.fdopen(descriptor, 'rb', closefd=False) as handle:
            return handle.read(65537)
    finally:
        os.close(descriptor)


def stopped_runtimes():
    observed = json.loads(subprocess.run(['/usr/bin/docker', 'inspect', *CONTAINERS],
        text=True, capture_output=True, check=True, timeout=15, env=ENVIRONMENT).stdout)
    if len(observed) != len(CONTAINERS):
        raise ValueError('Financial container inventory differs')
    for value, name in zip(observed, CONTAINERS):
        state = value.get('State', {})
        if (value.get('Name') != '/' + name or state.get('Running') is not False
                or state.get('Restarting') is not False or state.get('Paused') is not False
                or value.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') != 'no'):
            raise ValueError('Financial containers must remain stopped')
    for name in SERVICES:
        state = subprocess.run(['/usr/bin/systemctl', 'show', name+'.service',
            '--property=ActiveState', '--value'], text=True, capture_output=True,
            check=True, timeout=10, env=ENVIRONMENT).stdout.strip()
        if state not in ('inactive', 'failed'):
            raise ValueError('Financial services must remain stopped')


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in [['--rehearse'], ['--apply']]:
        raise ValueError('Root and explicit policy mode required')
    directory = Path(__file__).absolute().parent
    for parent in [directory, *directory.parents]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Unsafe root policy directory')
    if stat.S_IMODE(directory.stat().st_mode) != 0o700:
        raise ValueError('Private policy directory required')
    candidate = render_sql(protected_read(directory / MIGRATION_NAME),
                           protected_read(directory / 'policy-guard.sql').decode(),
                           apply=sys.argv[1]=='--apply')
    stopped_runtimes()
    result = subprocess.run(DATABASE, input=candidate, text=True, capture_output=True,
                            timeout=60, env=ENVIRONMENT)
    if result.returncode:
        raise ValueError('Policy database transaction refused or unconfirmed')
    stopped_runtimes()
    print(json.dumps(dict(status='interest-policy-installed-inactive' if sys.argv[1]=='--apply'
                          else 'interest-policy-rehearsal-rolled-back',
                          databaseApplied=sys.argv[1]=='--apply', servicesStarted=False,
                          bridgeAccessGranted=False, payoutPolicyCreated=False,
                          balancesChanged=False, phonePushVerified=False,
                          sqlSha256=hashlib.sha256(candidate.encode()).hexdigest())))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(dict(status='refused', databaseApplied=None,
            servicesStarted=False, reason=str(error) if isinstance(error, ValueError)
            else 'Reviewed policy operation unconfirmed', redacted=True)))
        sys.exit(1)
