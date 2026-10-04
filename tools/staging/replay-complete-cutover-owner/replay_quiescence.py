"""Pure replay-specific halted-claimant observation; never execution authority.

The parent authenticates collector origins/bytes and holds exclusive launch control.
Unknown claimant discovery/blocking belongs to the parent's complete inventory;
this validator does not assert that the fixed list exhausts all possible claimants.
before/after contain only the three fixed claimant inspections and scoped units;
public HTTP and notification units are intentionally outside this validator.
receipt is the observedAt/identity/drain projection of cutover_database.SNAPSHOT_SQL,
not an application-DB drain or a caller-normalized identity. Its transaction count
covers all other client transactions in the receipt DB, not merely named roles.
No SQL, collector callbacks, stop/start capability or credential access is provided.
Failed background exit 1 is halted evidence, never a healthy/completed worker proof.
Observation does not authenticate receipts, install a fence or permit replay.
"""

from datetime import datetime, timezone
import re

from cutover_runtime import COMPETITOR_ID, NATIVE_ID


DEADLINE = '2026-10-06T15:59:10Z'
CLAIMANTS = {
    'pvb-staging-replay-prefunded': NATIVE_ID,
    'baci-interest-replay': COMPETITOR_ID,
    'baci-prefunded-background': '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4',
}
UNITS = ('baci-prefunded-background.service', 'baci-prefunded-background.timer',
    'baci-staging-test-payments.service')
RECEIPT_IDENTITY = dict(systemIdentifier='7686901100561231906', sessionUser='supabase_admin',
    currentUser='supabase_admin', authenticatedUser='supabase_admin', database='postgres',
    localUnix=True, superuser=True, readOnly=True)
DRAIN = dict(transactions=0, preparedTransactions=0, processingReceipts=0)


def _require(condition):
    if not condition:
        raise ValueError('replay_quiescence_refused')


def _exact(value, expected):
    _require(type(value) is dict and set(value) == set(expected)
        and all(type(value[key]) is type(item) and value[key] == item for key, item in expected.items()))


def _time(value):
    _require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', value))
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _container(value, name, identifier):
    _require(type(value) is dict and type(value['Id']) is str and value['Id'] == identifier
        and type(value['Name']) is str and value['Name'] == '/' + name and type(value['HostConfig']) is dict)
    state = value['State']
    expected = dict(Running=False, Paused=False, Restarting=False, Dead=False, OOMKilled=False,
        ExitCode=1 if name == 'baci-prefunded-background' else 0, Status='exited', Pid=0)
    _require(type(state) is dict and all(type(state[key]) is type(item) and state[key] == item
        for key, item in expected.items()))
    _exact(value['HostConfig']['RestartPolicy'], dict(Name='no', MaximumRetryCount=0))


def _unit(value, name):
    background = name == 'baci-prefunded-background.service'
    expected = dict(LoadState='loaded', ActiveState='inactive', SubState='dead',
        FragmentPath='/etc/systemd/system/' + name, DropInPaths='', NeedDaemonReload='no',
        Transient='no', pendingJobs=[])
    if name.endswith('.service'):
        expected.update(Restart='no', MainPID='0')
    if background:
        _require(type(value) is dict and (value['ActiveState'], value['SubState'],
            value['Result'], value['ExecMainStatus']) in (
                ('failed', 'failed', 'exit-code', '1'), ('inactive', 'dead', 'success', '0')))
        expected.update(ActiveState=value['ActiveState'], SubState=value['SubState'],
            Result=value['Result'], ExecMainStatus=value['ExecMainStatus'])
    _exact(value, expected)


def _sample(value):
    _require(type(value) is dict and set(value) == {'observedAt', 'deadline', 'containers', 'units'}
        and value['deadline'] == DEADLINE and type(value['containers']) is dict
        and set(value['containers']) == set(CLAIMANTS) and type(value['units']) is dict
        and set(value['units']) == set(UNITS))
    for name, identifier in CLAIMANTS.items():
        _container(value['containers'][name], name, identifier)
    for name in UNITS:
        _unit(value['units'][name], name)
    return _time(value['observedAt'])


def verify_replay_quiescence(*, before: dict, after: dict, receipt: dict, now: datetime) -> dict:
    """Validate parent-collected evidence only; public/notification state is not gated."""
    try:
        _require(type(now) is datetime and now.tzinfo is not None
            and now.utcoffset().total_seconds() == 0 and now < _time(DEADLINE))
        first, last = _sample(before), _sample(after)
        _require(type(receipt) is dict and set(receipt) == {'observedAt', 'identity', 'drain'})
        _exact(receipt['identity'], RECEIPT_IDENTITY)
        _exact(receipt['drain'], DRAIN)
        measured = _time(receipt['observedAt'])
        _require(first <= measured <= last <= now and 0 <= (last-first).total_seconds() <= 30
            and 0 <= (now-first).total_seconds() <= 60)
        return dict(status='replay-claimants-quiescent', observedAt=after['observedAt'],
            stoppedClaimants=dict(CLAIMANTS), receiptSystemIdentifier=RECEIPT_IDENTITY['systemIdentifier'],
            failedBackgroundHalted=True, financialActionAuthorized=False, runtimeStartAuthorized=False,
            transactions=0, preparedTransactions=0, processingReceipts=0)
    except Exception:
        raise ValueError('replay_quiescence_refused') from None
