import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import activation_contract as contract
from activation_recovery import recover


ENVIRONMENT = dict(HOME='/root', PATH='/usr/sbin:/usr/bin:/sbin:/bin', LANG='C', LC_ALL='C', TZ='UTC')
OLD_CONTAINERS = ('pvb-staging-replay-prefunded', 'pvb-staging-replay-prefunded-check',
                  'baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot')
OLD_SERVICES = ('baci-prefunded-public', 'baci-prefunded-background',
                'baci-prefunded-snapshot', 'baci-staging-test-payments')
SNAPSHOT = """BEGIN READ ONLY; SELECT jsonb_build_object(
 'system',(SELECT system_identifier::text FROM pg_control_system()),
 'principal',(SELECT current_amount*100 FROM public.customer_savings_goals
  WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
 'policies',(SELECT count(*) FROM piggyvest_savings_ledger.interest_policies),
 'allocations',(SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations),
 'receipts',(SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts),
 'treasury',(SELECT jsonb_build_array(verified_available_kobo,reserved_kobo,consumed_kobo)
  FROM prefunded_card.treasury_bindings WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
 'retired',(SELECT phase FROM prefunded_card.checkout_intents
  WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d')); ROLLBACK;"""
EXPECTED = dict(system='7685292944002592802', principal=10000, policies=0,
                allocations=0, receipts=0, treasury=[10000, 0, 0], retired='retired_unconfirmed')


def command(arguments, source=None, timeout=30, checked=True):
    result = subprocess.run(arguments, input=source, text=True, capture_output=True,
                            timeout=timeout, env=ENVIRONMENT)
    if checked and result.returncode:
        raise ValueError('reviewed-command-refused')
    return result


def database(source):
    return command(['/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1',
                    'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres',
                    '-v', 'ON_ERROR_STOP=1'], source).stdout.strip()


def docker(arguments, **options):
    return command(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', *arguments], **options)


def protected_state():
    if json.loads(database(SNAPSHOT)) != EXPECTED:
        raise ValueError('protected-state')
    existing = json.loads(docker(['inspect', *OLD_CONTAINERS]).stdout)
    if len(existing) != len(OLD_CONTAINERS):
        raise ValueError('old-inventory')
    for actual, name in zip(existing, OLD_CONTAINERS):
        if (actual['Name'] != '/'+name or actual['State']['Running']
                or actual['State']['Paused'] or actual['State']['Restarting']
                or actual['HostConfig']['RestartPolicy']['Name'] != 'no'):
            raise ValueError('old-runtime-running')
    for name in OLD_SERVICES:
        state = command(['/usr/bin/systemctl', 'show', name+'.service',
                         '--property=ActiveState', '--value']).stdout.strip()
        if state not in ('inactive', 'failed'):
            raise ValueError('old-service-active')


def install_file(path, data, mode=0o440, group=65532):
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.chown(path, 0, group)
    os.chmod(path, mode)


def create_runtime(name, check=False):
    arguments = ['create', '--name', name, '--network', 'baci-isolated-savings_database',
        '--add-host', 'piggyvest-db.staging.baci.internal:172.23.0.2', '--user', '65532:65532',
        '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64',
        '--memory', '384m', '--cpus', '0.5', '--restart=no',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m', '--env', 'NODE_ENV=development',
        '--mount', f'type=bind,src={contract.TARGET}/replay-daemon.mjs,dst=/opt/pvb-replay/replay-daemon.mjs,readonly',
        '--mount', f'type=bind,src={contract.TARGET}/config.json,dst=/run/pvb-replay/config.json,readonly',
        contract.IMAGE, 'node', '/opt/pvb-replay/replay-daemon.mjs']
    if check:
        arguments.append('--check')
    identity = docker(arguments).stdout.strip()
    docker(['network', 'connect', 'pvb-staging-receipts', identity])
    return identity


def verify_runtime(value, name):
    if (value['Name'] != '/'+name or value['Image'] != contract.IMAGE
            or value['Config']['User'] != '65532:65532'
            or not value['HostConfig']['ReadonlyRootfs']
            or value['HostConfig']['RestartPolicy']['Name'] != 'no'
            or set(value['NetworkSettings']['Networks']) !=
                {'baci-isolated-savings_database', 'pvb-staging-receipts'}):
        raise ValueError('restricted-container')


def effective_units(units):
    for name, data in units.items():
        path = Path('/etc/systemd/system') / name
        if path.read_bytes() != data:
            raise ValueError('unit-bytes')
        observed = command(['/usr/bin/systemctl', 'show', name, '--property=LoadState',
            '--property=DropInPaths', '--property=NeedDaemonReload', '--property=FragmentPath']).stdout
        properties = dict(line.split('=', 1) for line in observed.splitlines())
        if (properties.get('LoadState') != 'loaded' or properties.get('DropInPaths') != ''
                or properties.get('NeedDaemonReload') != 'no'
                or properties.get('FragmentPath') != str(path)):
            raise ValueError('effective-unit')


def verify_started(identity):
    for attempt in range(10):
        active = json.loads(docker(['inspect', identity]).stdout)[0]
        verify_runtime(active, contract.CONTAINER)
        if active['State']['Running']:
            time.sleep(1)
            confirmed = json.loads(docker(['inspect', identity]).stdout)[0]
            verify_runtime(confirmed, contract.CONTAINER)
            if (confirmed['State']['Running'] and command(
                    ['/usr/bin/systemctl', 'is-active', contract.SERVICE]).stdout.strip() == 'active'):
                return
            raise ValueError('interest-container-exited')
        if active['State'].get('Status') in ('exited', 'dead'):
            raise ValueError('interest-container-exited')
        time.sleep(0.2)
    raise ValueError('interest-container-start')


def run(sql_pin, state):
    state['stage'] = 'preflight'
    if os.geteuid() != 0:
        raise ValueError('root-required')
    os.umask(0o077)
    contract.validate_window()
    directory = Path(__file__).absolute().parent
    source = contract.verified_file(directory / 'grant-bridge.sql', 0o600, sql_pin)
    config = contract.verified_file(contract.CONFIGURATION, 0o440, contract.CONFIGURATION_SHA)
    daemon = contract.verified_file(contract.DAEMON, 0o440, contract.DAEMON_SHA)
    parsed = json.loads(config)
    if ('prefundedReplay' in parsed or 'interestAccrualSigningSecret' in parsed
            or parsed.get('financialDatabase', {}).get('role') != 'prefunded_treasury_operator'):
        raise ValueError('interest-only-mode')
    protected_state()
    for name in (contract.CONTAINER, contract.CONTAINER+'-check'):
        if docker(['ps', '-aq', '--filter', 'name=^/'+name+'$']).stdout.strip():
            raise ValueError('existing-interest-container')
    units = contract.unit_files()
    if contract.TARGET.exists() or contract.TARGET.is_symlink():
        raise ValueError('existing-interest-target')
    for name in units:
        path = Path('/etc/systemd/system') / name
        if path.exists() or path.is_symlink() or Path(str(path)+'.d').exists():
            raise ValueError('existing-interest-unit')
    state['stage'] = 'rollback-rehearsal'
    database(contract.render_sql(source, sql_pin))
    protected_state()
    target = json.loads(docker(['inspect', 'baci-isolated-savings-db-1']).stdout)[0]
    if target['NetworkSettings']['Networks']['baci-isolated-savings_database']['IPAddress'] != '172.23.0.2':
        raise ValueError('tls-host-binding')
    state['stage'] = 'private-installation'
    contract.TARGET.mkdir(mode=0o700)
    state['targetCreated'] = True
    install_file(contract.TARGET / 'replay-daemon.mjs', daemon)
    install_file(contract.TARGET / 'config.json', config)
    for name, content in units.items():
        install_file(Path('/etc/systemd/system') / name, content, 0o644, 0)
    command(['/usr/bin/systemd-analyze', 'verify', *[str(Path('/etc/systemd/system')/name) for name in units]])
    state['grantAttempted'] = True
    state['stage'] = 'bridge-grant'
    database(contract.render_sql(source, sql_pin, True))
    state['stage'] = 'restricted-tls-readiness'
    check_id = create_runtime(contract.CONTAINER+'-check', True)
    output = docker(['start', '-a', check_id], timeout=45)
    check = json.loads(docker(['inspect', check_id]).stdout)[0]
    verify_runtime(check, contract.CONTAINER+'-check')
    if (check['State']['ExitCode'] != 0 or check['State']['Running']
            or output.stderr.strip() or json.loads(output.stdout.strip()) !=
            dict(status='replay-runtime-ready', readOnly=True)):
        raise ValueError('restricted-readiness')
    docker(['rm', check_id])
    identity = create_runtime(contract.CONTAINER)
    verify_runtime(json.loads(docker(['inspect', identity]).stdout)[0], contract.CONTAINER)
    command(['/usr/bin/systemctl', 'daemon-reload'])
    effective_units(units)
    state['stage'] = 'deadline-arming'
    command(['/usr/bin/systemctl', 'enable', '--now', contract.DEADLINE_TIMER])
    next_deadline = command(['/usr/bin/systemctl', 'show', contract.DEADLINE_TIMER,
                             '--property=NextElapseUSecRealtime', '--value']).stdout.strip()
    if '2026-10-06 15:59:10 UTC' not in next_deadline:
        raise ValueError('effective-deadline')
    contract.validate_window()
    protected_state()
    state['stage'] = 'runtime-start'
    command(['/usr/bin/systemctl', 'start', contract.SERVICE])
    verify_started(identity)
    protected_state()
    return dict(status='restricted-interest-replay-active', expiresAt=contract.DEADLINE,
                restrictedTlsVerified=True, bridgeAccessGranted=True, policies=0,
                principalKobo=10000, paidReceipts=0, cardPaymentsEnabled=False,
                providerPayoutObserved=False, phoneInterestVerified=False)


if __name__ == '__main__':
    state = {}
    try:
        if len(sys.argv) != 2 or len(sys.argv[1]) != 64:
            raise ValueError('sealed-sql-pin-required')
        report = run(sys.argv[1], state)
        print(json.dumps(report))
        print('INTEREST_ONLY_REPLAY_ACTIVE')
    except Exception as error:
        recovery = dict(newRuntimeStopped=False, bridgeGrantRolledBack=False)
        try:
            recovery = recover(state, command, docker, database)
        except Exception:
            pass
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z-]{1,64}', str(error)) else 'unclassified'
        print(json.dumps(dict(status='refused', stage=state.get('stage', 'arguments'), reasonCode=reason,
                             errorType=type(error).__name__, redacted=True,
                             activationUnconfirmed=True, recovery=recovery)))
        raise SystemExit(1)
