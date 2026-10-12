import grp
import json
from pathlib import Path
import pwd
import stat
from urllib.parse import parse_qs, urlsplit

from notification_contract import (
    ACCOUNT, CHECK, DEADLINE, PINS, SECRET, SERVICE, STOPPER, TARGET_EPOCH, TIMER,
    UNIT_ROOT, Refused, candidate_units, ensure_window, validate_effective, verify_stopper,
)
from notification_database import DOCKER
from notification_io import read_file


SYSTEMCTL = '/usr/bin/systemctl'
PROPERTIES = ('LoadState', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'Transient',
              'ActiveState', 'SubState', 'UnitFileState', 'ExecStart', 'ExecCondition', 'Triggers',
              'NextElapseUSecRealtime', 'Result', 'ExecMainStatus', 'ExecMainCode',
              'ExecMainStartTimestampMonotonic', 'RemainAfterExit')


def state(run, name):
    output = run([SYSTEMCTL, 'show', name, '--property=' + ','.join(PROPERTIES)])
    values = {}
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        if not separator or key in values:
            raise Refused('systemd-state-shape')
        values[key] = value
    return values


def quiescent(run):
    for name in (TIMER, SERVICE, CHECK, STOPPER):
        validate_effective(name, state(run, name), quiescent=True)
    deadline = state(run, DEADLINE)
    validate_effective(DEADLINE, deadline)
    if (deadline.get('ActiveState'), deadline.get('SubState')) not in (('inactive', 'dead'), ('active', 'elapsed')):
        raise Refused('old-deadline-state')
    verify_stopper(state(run, STOPPER))


def verify_account(run):
    account = pwd.getpwnam(ACCOUNT)
    group = grp.getgrnam(ACCOUNT)
    if (account.pw_uid == 0 or account.pw_gid != group.gr_gid or group.gr_mem
            or account.pw_dir != '/nonexistent' or account.pw_shell != '/usr/sbin/nologin'
            or any(ACCOUNT in item.gr_mem for item in grp.getgrall())):
        raise Refused('worker-account')
    result = run(['/usr/bin/passwd', '-S', ACCOUNT]).split()
    if len(result) < 2 or result[0] != ACCOUNT or result[1] != 'L':
        raise Refused('worker-account-unlocked')


def verify_credential():
    metadata = Path(SECRET).parent.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o700):
        raise Refused('credential-directory')
    content = read_file(SECRET, 0o600, 8192)
    try:
        parsed = urlsplit(content.decode('ascii').strip())
        query = parse_qs(parsed.query, strict_parsing=True)
        if (parsed.scheme != 'postgresql' or parsed.username != 'baci_savings_notifications_worker'
                or not parsed.password or parsed.hostname != 'piggyvest-db.staging.baci.internal'
                or parsed.port != 5432 or parsed.path != '/postgres' or parsed.fragment
                or query != {'sslmode': ['verify-full'], 'sslrootcert': ['/opt/baci-savings-notifications/postgres-ca.pem']}):
            raise ValueError()
    except (UnicodeError, ValueError):
        raise Refused('credential-tls-target') from None
    return content


def verify_transport(run):
    rows = json.loads(run([*DOCKER, 'inspect', 'baci-isolated-savings-db-1']))
    if len(rows) != 1 or rows[0].get('Name') != '/baci-isolated-savings-db-1':
        raise Refused('database-container')
    container = rows[0]
    active = container.get('State', {})
    if active.get('Running') is not True or active.get('Paused') is not False or active.get('Restarting') is not False:
        raise Refused('database-container-state')
    networks = container.get('NetworkSettings', {}).get('Networks', {})
    addresses = {entry.get('IPAddress') for entry in networks.values()}
    if '172.23.0.2' not in addresses:
        raise Refused('database-container-address')
    resolved = run(['/usr/bin/getent', 'ahostsv4', 'piggyvest-db.staging.baci.internal']).splitlines()
    address_set = {line.split()[0] for line in resolved if line.split()}
    loopback = container.get('NetworkSettings', {}).get('Ports', {}).get('5432/tcp', []) or []
    if address_set == {'127.0.0.1'} and any(entry == {'HostIp': '127.0.0.1', 'HostPort': '5432'} for entry in loopback):
        return
    if address_set != {'172.23.0.2'}:
        raise Refused('database-tls-resolution')


def preflight(run):
    ensure_window()
    quiescent(run)
    originals = {path: read_file(path, 0o444) for path in PINS}
    candidates = candidate_units(originals)
    verify_account(run)
    credential = verify_credential()
    verify_transport(run)
    return originals, candidates, credential


def verify_installed(run, originals, candidates, credential):
    ensure_window()
    for path, old_content in originals.items():
        if read_file(path, 0o444) != candidates.get(path, old_content):
            raise Refused('installed-file-drift')
    if verify_credential() != credential:
        raise Refused('credential-changed')
    for name in (SERVICE, CHECK, TIMER, STOPPER, DEADLINE):
        value = state(run, name)
        validate_effective(name, value)
        if name in (SERVICE, CHECK):
            condition = value.get('ExecCondition', '')
            if str(TARGET_EPOCH) not in condition or '1790697550' in condition:
                raise Refused('effective-expiry-condition')
        if name == CHECK:
            verify_check_command(value)
    verify_stopper(state(run, STOPPER))


def verify_check_command(value):
    if value.get('RemainAfterExit') != 'yes':
        raise Refused('effective-readonly-check-command')
    command = value.get('ExecStart', '')
    for required in ('argv[]=/bin/sh -eu -c ', '$CREDENTIALS_DIRECTORY/db-url',
                     'SAVINGS_NOTIFICATIONS_DATABASE_NAME=postgres', 'SAVINGS_NOTIFICATIONS_ENABLED=true',
                     'exec /usr/bin/node /opt/baci-savings-notifications/worker.mjs --check', 'ignore_errors=no'):
        if required not in command:
            raise Refused('effective-readonly-check-command')


def readonly_check(run):
    ensure_window()
    previous = state(run, CHECK)
    try:
        run([SYSTEMCTL, 'start', CHECK])
        current = state(run, CHECK)
        started = int(current.get('ExecMainStartTimestampMonotonic') or '0')
        if (current.get('Result') != 'success' or current.get('ExecMainStatus') != '0'
                or current.get('ExecMainCode') not in ('1', 'exited')
                or current.get('ActiveState') != 'active' or current.get('SubState') != 'exited'
                or started <= 0 or started <= int(previous.get('ExecMainStartTimestampMonotonic') or '0')):
            raise Refused('readonly-check-not-executed-successfully')
    finally:
        run([SYSTEMCTL, 'stop', CHECK])
        validate_effective(CHECK, state(run, CHECK), quiescent=True)


def verify_deadline(run):
    deadline = state(run, DEADLINE)
    validate_effective(DEADLINE, deadline)
    if (deadline.get('ActiveState') != 'active' or deadline.get('SubState') != 'waiting'
            or deadline.get('UnitFileState') != 'enabled' or deadline.get('Triggers') != STOPPER
            or not deadline.get('NextElapseUSecRealtime')):
        raise Refused('deadline-not-armed')
    epoch = run(['/usr/bin/date', '-u', '--date=' + deadline['NextElapseUSecRealtime'], '+%s']).strip()
    if epoch != str(TARGET_EPOCH):
        raise Refused('deadline-schedule')
    verify_stopper(state(run, STOPPER))


def schedule(run):
    ensure_window()
    run([SYSTEMCTL, 'enable', '--now', DEADLINE])
    verify_deadline(run)
    ensure_window()
    run([SYSTEMCTL, 'enable', '--now', TIMER])
    timer = state(run, TIMER)
    validate_effective(TIMER, timer)
    if timer.get('ActiveState') != 'active' or timer.get('UnitFileState') != 'enabled' or timer.get('Triggers') != SERVICE:
        raise Refused('notification-scheduler')
    verify_deadline(run)
