"""Read-only writer drain; neither stops services nor authorizes a financial pass.

The parent must independently verify source authority, the closed target/expired
lease set, authenticated native evidence and a complete protected baseline.
"""

from datetime import datetime, timezone
import json

from cutover_runtime import COMPETITOR_ID, DOCKER, NATIVE_ID, NATIVE_ROOT, NATIVE_SEAL, require


STOPPED = {
    'baci-prefunded-background': '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4',
    'baci-prefunded-snapshot': '2d299353bfa0457bb7486ba5be97c6630286b74f9e9b057439bcb83ad3708818',
    'baci-prefunded-readiness': 'a59ecc7c88b857bb8ba5a2fbdda55d5d48b6cf12e8e40973bacf7f69258d23c4',
    'baci-prefunded-public': 'c6e802349659140803be6b5c2c2f79fca6036f8cbaad50598d67da573d33fa5c',
}
UNITS = ('baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
    'baci-savings-notifications.timer', 'baci-savings-notifications.service',
    'baci-savings-notifications-check.service', 'baci-staging-test-payments.service',
    'baci-prefunded-public.service', 'baci-prefunded-background.service')
PROPERTIES = ('LoadState', 'ActiveState', 'SubState', 'FragmentPath',
    'DropInPaths', 'NeedDaemonReload', 'Transient')
DRAIN_SQL = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='8s';
SET LOCAL lock_timeout='2s';
DO $identity$ BEGIN
  IF session_user<>'postgres' OR current_user<>session_user OR inet_client_addr() IS NOT NULL
    OR current_database()<>'postgres'
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
    OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN
    RAISE EXCEPTION 'financial quiescence identity refused' USING ERRCODE='42501'; END IF;
END $identity$;
SELECT jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'sessionUser',session_user,'currentUser',current_user,'database',current_database(),
  'localUnix',inet_client_addr() IS NULL,'readOnly',current_setting('transaction_read_only')='on',
  'preparedTransactions',(SELECT count(*) FROM pg_prepared_xacts),
  'otherClientTransactions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()
    AND backend_type='client backend' AND xact_start IS NOT NULL));
ROLLBACK;
"""
IDENTITY = dict(systemIdentifier='7685292944002592802', sessionUser='postgres',
    currentUser='postgres', database='postgres', localUnix=True, readOnly=True,
    preparedTransactions=0, otherClientTransactions=0)


def _unit(context, name):
    names = PROPERTIES + (('Restart',) if name.endswith('.service') else ())
    output = context.owner.command(['/usr/bin/systemctl', 'show', name,
        *['--property=' + key for key in names]], timeout=10)
    require(type(output) is str and len(output) <= 8192, 'unit_refused')
    values = {}
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        require(separator and key in names and key not in values, 'unit_refused')
        values[key] = value
    expected = dict(LoadState='loaded', ActiveState='inactive', SubState='dead',
        FragmentPath='/etc/systemd/system/' + name, DropInPaths='', NeedDaemonReload='no', Transient='no')
    if name.endswith('.service'):
        expected['Restart'] = 'no'
    require(values == expected, 'unit_refused')


def _stopped(value, identifier, name):
    require(type(value) is dict and value['Id'] == identifier and value['Name'] == '/' + name,
        'stopped_identity_refused')
    state = value['State']
    exit_codes = (0, 143) if name == 'baci-prefunded-public' else (0,)
    require(all(state[key] is False for key in ('Running', 'Paused', 'Restarting', 'Dead', 'OOMKilled'))
        and type(state['ExitCode']) is int and state['ExitCode'] in exit_codes
        and state['Status'] in ('created', 'exited')
        and value['HostConfig']['RestartPolicy'] == dict(Name='no', MaximumRetryCount=0),
        'stopped_state_refused')


def _writers(context):
    native = context.operator.inspect(NATIVE_ID, NATIVE_ROOT, NATIVE_SEAL,
        name='pvb-staging-replay-prefunded')
    _stopped(native, NATIVE_ID, 'pvb-staging-replay-prefunded')
    _stopped(context.competitor(), COMPETITOR_ID, 'baci-interest-replay')
    for name, identifier in STOPPED.items():
        values = json.loads(context.owner.command([*DOCKER, 'inspect', name], timeout=10))
        require(type(values) is list and len(values) == 1, 'stopped_identity_refused')
        _stopped(values[0], identifier, name)
    for name in UNITS:
        _unit(context, name)


def verify_financial_quiescence(context):
    try:
        before = datetime.now(timezone.utc)
        context.deadline()
        require(context.verify_files() is True and context.exclusive() is True, 'exclusive_refused')
        _writers(context)
        drain = json.loads(context.finance['database'](DRAIN_SQL))
        require(type(drain) is dict and set(drain) == set(IDENTITY)
            and all(type(drain[key]) is type(expected) and drain[key] == expected
                for key, expected in IDENTITY.items()), 'transaction_drain_refused')
        require(context.exclusive() is True and context.verify_files() is True, 'exclusive_refused')
        _writers(context)
        context.deadline()
        now = datetime.now(timezone.utc)
        require(0 <= (now - before).total_seconds() <= 30, 'quiescence_stale')
        return dict(status='financial-writers-quiescent', observedAt=now.isoformat().replace('+00:00', 'Z'),
            stoppedContainers=STOPPED | {'pvb-staging-replay-prefunded': NATIVE_ID,
                'baci-interest-replay': COMPETITOR_ID}, preparedTransactions=0, otherClientTransactions=0)
    except Exception:
        raise ValueError('financial_quiescence_refused') from None
