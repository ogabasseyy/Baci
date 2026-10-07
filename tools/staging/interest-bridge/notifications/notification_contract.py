import hashlib
import re
import time


ROLE = 'baci_savings_notifications_worker'
ACCOUNT = 'baci-savings-notifications'
SYSTEM = '7685292944002592802'
OLD = '2026-09-29T15:59:10Z'
TARGET = '2026-10-06T15:59:10Z'
OLD_EPOCH = 1790697550
TARGET_EPOCH = 1791302350
SERVICE = ACCOUNT + '.service'
CHECK = ACCOUNT + '-check.service'
TIMER = ACCOUNT + '.timer'
STOPPER = ACCOUNT + '-deadline.service'
DEADLINE = ACCOUNT + '-deadline.timer'
UNIT_ROOT = '/etc/systemd/system/'
SECRET = '/etc/baci/piggyvest-staging/notifications/database-url'
PINS = {
    UNIT_ROOT + SERVICE: 'ea164d0606f5d159307c2970613be7a5b9c5f25d4874756299e49f8dbbf1f657',
    UNIT_ROOT + CHECK: '6c103c1861585cd518c9ab7dc7c72d4ba026ac5793aa2fff6076794b56b8b770',
    UNIT_ROOT + TIMER: '5b8ed97034b66bc0e68a8e585ae93cd9a2186ddd3bacd534481e309ce3003fbe',
    UNIT_ROOT + STOPPER: '0611c0d1c6ac5b0336e5e4e900e6e3f7393672a261edb52274b495f7cdc5874d',
    UNIT_ROOT + DEADLINE: 'ab97ae68b7e7d955e19a2e45d47b6e2cbc0ef6f2b33dff5ddf45141a95847dfb',
    '/opt/baci-savings-notifications/worker.mjs': 'b15d631ccc8c39de8568589eaa930febcd234b17e4b403d6c9c96c42983b2c5a',
    '/opt/baci-savings-notifications/postgres-ca.pem': '82944208414e7661c26d544b70664be078c5ca057275cd4120f1de1d20d15f23',
}
ROUTINES = {
    'claim_push(integer)': ('58cea12689f153e273ecd1e92d845b38', 'plpgsql'),
    'contribution_recorded()': ('810e43a0064954eecbfa529acba1ce55', 'plpgsql'),
    'customer_for(uuid)': ('96549289d38c381e3fa4b5c6e71a7562', 'plpgsql'),
    'emit(uuid, text, text, text, text, timestamp with time zone)': ('bb01332854d79a66e03e96f99ee10a5c', 'sql'),
    'enqueue_due()': ('8f18c011cb4a63636ae843179638ab7f', 'sql'),
    'finish_push(uuid, text, uuid, text, text)': ('ab11c40918f15f44ba4adbd98f7abae6', 'plpgsql'),
    'generate_due(timestamp with time zone)': ('8dca10e196172ead14e9d6479a627e4d', 'plpgsql'),
    'interest_recorded()': ('018e14ba26d9ddc98db2436372e930b6', 'plpgsql'),
    'pending_receipts(integer)': ('e1e5eaabbf730ada6e6484efc37135d0', 'plpgsql'),
    'preference_json(uuid, uuid)': ('682ee6b6c74c9192a639f229294ec411', 'sql'),
    'push_allowed(savings_notifications.events, boolean, timestamp with time zone)': ('eedd7d0cb92c7a4eecf468d635f44452', 'plpgsql'),
    'record_receipt(text, text, text)': ('e27e2fbad2e3f26fa4301aa02141512f', 'plpgsql'),
}
EXECUTABLE = {'enqueue_due()', 'claim_push(integer)', 'finish_push(uuid, text, uuid, text, text)',
              'pending_receipts(integer)', 'record_receipt(text, text, text)'}


class Refused(RuntimeError):
    pass


def digest(content):
    return hashlib.sha256(content).hexdigest()


def ensure_window(now=None):
    if not OLD_EPOCH <= (time.time() if now is None else now) < TARGET_EPOCH - 180:
        raise Refused('renewal-window')


def candidate_units(originals):
    for path, content in originals.items():
        if path not in PINS or digest(content) != PINS[path]:
            raise Refused('predecessor-pin')
    if set(originals) != set(PINS):
        raise Refused('predecessor-inventory')
    result = {}
    for name in (SERVICE, CHECK, DEADLINE):
        path = UNIT_ROOT + name
        old = str(OLD_EPOCH).encode() if name != DEADLINE else b'2026-09-29 15:59:10 UTC'
        new = str(TARGET_EPOCH).encode() if name != DEADLINE else b'2026-10-06 15:59:10 UTC'
        if originals[path].count(old) != 1:
            raise Refused('deadline-field')
        result[path] = originals[path].replace(old, new)
        if name == CHECK:
            result[path] += b'RemainAfterExit=yes\n'
    return result


def validate_routines(rows):
    if not isinstance(rows, list) or len(rows) != len(ROUTINES):
        raise Refused('routine-inventory')
    seen = set()
    for row in rows:
        signature = row.get('signature')
        if (signature in seen or signature not in ROUTINES
                or (row.get('bodyMd5'), row.get('language')) != ROUTINES[signature]
                or row.get('owner') != 'postgres' or row.get('securityDefiner') is not True
                or row.get('config') != ['search_path=""']
                or row.get('acl') != routine_acl(signature)):
            raise Refused('routine-source-baseline')
        seen.add(signature)


def routine_acl(signature):
    return '{postgres=X/postgres' + (',' + ROLE + '=X/postgres' if signature in EXECUTABLE else '') + '}'


def validate_database(value, expiry=OLD):
    role = value.get('role', {})
    if (value.get('systemIdentifier') != SYSTEM or value.get('database') != 'postgres'
            or value.get('sessionUser') != 'postgres' or value.get('localSocket') is not True
            or role.get('exists') is not True or role.get('canLogin') is not True
            or role.get('validUntil') != expiry or role.get('memberCount') != 0
            or role.get('configIsNull') is not True):
        raise Refused('database-role-identity')
    for flag in ('inherit', 'superuser', 'bypassRls', 'createDb', 'createRole', 'replication'):
        if role.get(flag) is not False:
            raise Refused('unsafe-role')
    if (value.get('goalMatches') != 1 or value.get('principalKobo') != 10000
            or value.get('goalAmount') != 100 or value.get('otherEligibleGoals') != 0
            or value.get('otherEvents') != 0 or value.get('orphanDeliveries') != 0
            or value.get('unscopedActiveTokens') != 0):
        raise Refused('synthetic-scope-or-principal')
    validate_routines(value.get('routines'))


def validate_effective(name, value, quiescent=False):
    if (value.get('FragmentPath') != UNIT_ROOT + name or value.get('LoadState') != 'loaded'
            or value.get('DropInPaths') != '' or value.get('NeedDaemonReload') != 'no'
            or value.get('Transient') != 'no'):
        raise Refused('effective-unit')
    if quiescent and (value.get('ActiveState') != 'inactive' or value.get('SubState') != 'dead'):
        raise Refused('notification-not-quiescent')


def verify_stopper(value):
    match = re.search(r'argv\[\]=([^;]+) ;', value.get('ExecStart', ''))
    expected = '/usr/bin/systemctl stop ' + ' '.join((TIMER, SERVICE, CHECK))
    if not match or match.group(1).strip() != expected or 'ignore_errors=no' not in value['ExecStart']:
        raise Refused('deadline-stop-targets')
