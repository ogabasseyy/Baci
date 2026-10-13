import hashlib
import json
import os
from pathlib import Path
import sys
from interest_runtime_configuration import build_interest_configuration
from runtime_owner_support import command, probe, read_replay_inputs
from treasury_owner_contract import Refused
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


PREPARED = Path('/etc/baci/prefunded-card/activation.prepared.json')
PREPARED_SHA256 = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
LEGACY_OWNER_UID = 1001
CONTAINERS = ('pvb-staging-replay-prefunded', 'pvb-staging-replay-prefunded-check',
              'baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot')
SERVICES = ('baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot',
            'baci-staging-test-payments')
SNAPSHOT = """SELECT jsonb_build_object(
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'principalKobo',(SELECT current_amount*100 FROM public.customer_savings_goals
    WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
  'allocations',(SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations),
  'paidReceipts',(SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts),
  'bridgeExecute',has_function_privilege('prefunded_treasury_operator',
    'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)','EXECUTE'),
  'login',(SELECT rolcanlogin FROM pg_roles WHERE rolname='prefunded_treasury_operator'),
  'unsafe',(SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
    FROM pg_roles WHERE rolname='prefunded_treasury_operator'),
  'expiresAt',(SELECT to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
    FROM pg_roles WHERE rolname='prefunded_treasury_operator'));"""
EXPECTED = dict(systemIdentifier='7685292944002592802', principalKobo=10000,
                allocations=0, paidReceipts=0, bridgeExecute=False,
                login=True, unsafe=False, expiresAt='2026-10-06T15:59:10Z')


def stopped_runtimes():
    values = json.loads(command(['/usr/bin/docker', 'inspect', *CONTAINERS]))
    if len(values) != len(CONTAINERS):
        raise Refused('Stopped financial inventory refused')
    for value, expected in zip(values, CONTAINERS):
        state = value.get('State', {})
        if (value.get('Name') != '/' + expected or state.get('Running') is not False
                or state.get('Paused') is not False or state.get('Restarting') is not False
                or state.get('Status') not in ('created', 'exited')
                or value.get('HostConfig', {}).get('RestartPolicy', {}).get('Name') != 'no'):
            raise Refused('Financial runtimes must remain stopped')
    services = []
    for name in SERVICES:
        state = command(['/usr/bin/systemctl', 'show', name + '.service',
                         '--property=ActiveState', '--value']).strip()
        if state not in ('inactive', 'failed'):
            raise Refused('Financial services must remain stopped')
        services.append((name, state))
    return (tuple((value['Name'], value['Id'], value['Image']) for value in values), tuple(services))


def read_prepared():
    root_ancestors(PREPARED)
    content = read_file(PREPARED, 0, 0o600, 131072)
    if hashlib.sha256(content).hexdigest() != PREPARED_SHA256:
        raise Refused('Prepared credential source changed')
    return json.loads(content)


def prepare(directory):
    private_directory(directory)
    root_ancestors(directory / 'interest-config.json')
    before_containers = stopped_runtimes()
    before = probe(SNAPSHOT)
    if before != EXPECTED:
        raise Refused('Interest preparation protected state refused')
    prepared = read_prepared()
    original, signing_keys = read_replay_inputs(LEGACY_OWNER_UID)
    configuration = build_interest_configuration(original, signing_keys, prepared)
    content = (json.dumps(configuration, sort_keys=True, separators=(',', ':')) + '\n').encode()
    output = directory / 'interest-config.json'
    write_private(output, content)
    os.chown(output, 0, 65532)
    os.chmod(output, 0o440)
    if probe(SNAPSHOT) != before or stopped_runtimes() != before_containers:
        raise Refused('Protected state changed during interest preparation')
    report = dict(status='interest-runtime-prepared-inactive', servicesStarted=False,
                  interestReplayCredentialsPrepared=True,
                  financialRenewalApplied=False, paymentCredentialsRenewed=False,
                  replayReady=False, bridgeAccessGranted=False, payoutAllocationCreated=False,
                  balancesChanged=False, expiresAt='2026-10-06T15:59:10Z',
                  configurationPath=str(output), configurationSha256=hashlib.sha256(content).hexdigest())
    write_private(directory / 'preparation-result.json', (json.dumps(report) + '\n').encode())
    return report


def main():
    try:
        if os.geteuid() != 0 or sys.argv[1:]:
            raise Refused('Root owner preparation required')
        report = prepare(Path(__file__).absolute().parent)
    except Exception:
        print(json.dumps(dict(status='refused', stage='interest-runtime-preparation',
                              redacted=True, servicesStarted=False, replayReady=False)))
        return 1
    print(json.dumps(report))
    return 0


if __name__ == '__main__':
    sys.exit(main())
