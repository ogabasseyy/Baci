import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from datetime import datetime, timezone


SYSTEM = '7685292944002592802'
RECEIPT_SYSTEM = '7686901100561231906'
OLD_DEADLINE = '2026-09-29T15:59:10Z'
NEW_DEADLINE = '2026-10-06T15:59:10Z'
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
DATABASE = 'baci-isolated-savings-db-1'
FILES = (
    '/etc/baci-savings-gateway/binding.json',
    '/etc/baci-savings-gateway/startup-evidence.json',
    '/var/lib/baci-savings-gateway-install/receipt.json',
    '/var/lib/baci-savings-gateway-install/renewal-receipt.json',
    '/etc/baci/prefunded-card/activation.prepared.json',
    '/etc/baci/prefunded-card/replay-base.prepared.json',
    '/etc/baci/prefunded-card/treasury-snapshot.json',
    '/etc/baci/piggyvest-staging/funding-service.env',
    '/home/bassey/pvb-staging-receipts/intake-config.json',
    '/opt/baci-prefunded-workers/config/background.json',
    '/opt/baci-prefunded-workers/config/snapshot.json',
    '/opt/baci-prefunded-public/config/checkout.json',
    '/opt/baci-prefunded-public/config/anon.json',
    '/opt/baci-prefunded-public/receipt.json',
    '/opt/baci-prefunded-replay/config/config.json',
    '/opt/baci-prefunded-replay/config/prefunded.json',
    '/opt/baci-savings-gateway/managed-gateway.mjs',
    '/opt/baci-savings-notifications/worker.mjs',
    '/opt/baci-prefunded-workers/code/background.sh',
    '/opt/baci-prefunded-workers/code/background.cjs',
    '/opt/baci-prefunded-workers/code/snapshot.cjs',
    '/opt/baci-prefunded-replay/code/prefunded-replay-bundle.mjs',
    '/opt/baci-prefunded-replay/code/replay-daemon.mjs',
    '/opt/baci-prefunded-public/app/launch-public.cjs',
)
SERVICES = (
    'baci-savings-gateway', 'baci-savings-drafts', 'baci-savings-drafts-smoke',
    'baci-savings-funding', 'baci-savings-notifications', 'baci-savings-notifications-check',
    'baci-staging-test-payments', 'baci-prefunded-public', 'baci-prefunded-background',
    'baci-prefunded-snapshot',
)
TIMERS = (
    'baci-savings-drafts-deadline', 'baci-savings-funding-deadline',
    'baci-savings-notifications', 'baci-savings-notifications-deadline',
    'baci-staging-test-payments-deadline', 'baci-prefunded-public-deadline',
    'baci-prefunded-deadline', 'baci-prefunded-replay-deadline',
    'baci-prefunded-background', 'baci-prefunded-snapshot',
)
CONTAINERS = (
    DATABASE, 'pvb-staging-receipts-db', 'pvb-staging-replay-prefunded',
    'baci-prefunded-public', 'baci-prefunded-background', 'baci-prefunded-snapshot',
)


def bounded_fields(value):
    pending = [(value, 0)]
    count = 0
    while pending:
        current, depth = pending.pop()
        count += 1
        if count > 10000 or depth > 12:
            raise ValueError('Configuration bounds exceeded')
        if isinstance(current, dict):
            for key, item in current.items():
                if isinstance(item, (dict, list)):
                    pending.append((item, depth + 1))
                else:
                    yield key, item
        elif isinstance(current, list):
            pending.extend((item, depth + 1) for item in current)


def deadline_fields(value):
    result = {}
    for key, item in bounded_fields(value):
        if (key in ('expiresAt', 'leaseExpiresAt', 'leaseNotBefore', 'reviewedAt', 'expires_at')
                and isinstance(item, str)
                and re.fullmatch(r'20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z', item)):
            result.setdefault(key, set()).add(item)
            if len(result[key]) > 8:
                raise ValueError('Deadline projection bounds exceeded')
    return {key: sorted(values) for key, values in result.items()}


def file_inventory(filename):
    filename = Path(filename)
    result = {'path': str(filename)}
    try:
        metadata = filename.lstat()
    except FileNotFoundError:
        return {**result, 'status': 'missing'}
    result.update(ownerUid=metadata.st_uid, mode=f'{stat.S_IMODE(metadata.st_mode):04o}', size=metadata.st_size)
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
            or metadata.st_mode & 0o022 or metadata.st_size > 16_000_000):
        return {**result, 'status': 'unsafe'}
    descriptor = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (before.st_dev, before.st_ino) != (metadata.st_dev, metadata.st_ino):
            raise RuntimeError('Concurrent file change')
        content = handle.read(16_000_001)
        after = os.fstat(handle.fileno())
    if (len(content) != before.st_size or len(content) > 16_000_000
            or after.st_mtime_ns != before.st_mtime_ns or after.st_ctime_ns != before.st_ctime_ns):
        raise RuntimeError('Concurrent file change')
    result.update(status='read', sha256=hashlib.sha256(content).hexdigest())
    result['oldDeadlineMentions'] = sum(content.count(marker) for marker in (
        OLD_DEADLINE.encode(), b'2026-09-29 15:59:10 UTC', b'1790697550',
    ))
    if filename.suffix == '.json':
        value = json.loads(content)
        result['deadlines'] = deadline_fields(value)
        result['unverifiedJwtExpiryClaims'] = jwt_expiry_fields(value, source=filename)
    return result


def jwt_expiry_fields(value, source=None):
    result = {}
    fields = [(key, item) for key, item in bounded_fields(value)
              if key in ('receiptToken', 'appToken', 'restToken', 'anonKey', 'supabaseAnonKey', 'publicKey')]
    if source == Path('/opt/baci-prefunded-public/config/anon.json') and isinstance(value, dict):
        fields.append(('key', value.get('key')))
    for key, item in fields:
        try:
            parts = item.split('.')
            if len(parts) != 3 or len(item) > 8192:
                continue
            payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
            expiry = payload.get('exp')
            if type(expiry) is int and 0 < expiry < 10_000_000_000:
                result.setdefault(key, set()).add(expiry)
        except (AttributeError, TypeError, ValueError):
            continue
        if len(result.get(key, ())) > 8:
            raise ValueError('JWT projection bounds exceeded')
    return {key: sorted(values) for key, values in result.items()}


def command(arguments, input_text=None):
    result = subprocess.run(arguments, input=input_text, text=True, capture_output=True,
                            timeout=30, env=ENVIRONMENT)
    if result.returncode or len(result.stdout) > 1_000_000:
        raise RuntimeError('Read-only inventory command refused')
    return result.stdout


def container_inventory(name):
    value = json.loads(command([*DOCKER, 'inspect', name]))[0]
    labels = value.get('Config', {}).get('Labels') or {}
    result = {'name': name, 'image': value['Image'], 'running': value['State']['Running'],
              'user': value['Config']['User'], 'readOnlyRootfs': value['HostConfig']['ReadonlyRootfs']}
    result['manifestPins'] = {key: item for key, item in labels.items()
        if key in ('com.baci.prefunded.public-manifest', 'com.baci.prefunded.worker-manifest',
                   'com.baci.prefunded-replay.sha256') and re.fullmatch('[a-f0-9]{64}', item)}
    if name == DATABASE and (labels.get('com.docker.compose.project') != 'baci-isolated-savings'
                            or labels.get('com.docker.compose.service') != 'db'):
        raise RuntimeError('Staging database container differs')
    return result


def database_inventory(container, binary, username, filename, expected_system):
    sql = Path(__file__).with_name(filename).read_text()
    output = command([*DOCKER, 'exec', '-i', container, binary,
                      '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
                      '-U', username, '-d', 'postgres'], sql)
    report = json.loads(output)
    if report.get('systemIdentifier') != expected_system or report.get('readOnly') is not True:
        raise RuntimeError('Staging database identity differs')
    return report


def collect():
    if os.geteuid() != 0:
        raise RuntimeError('Owner read access required')
    units = [name + '.service' for name in SERVICES] + [name + '.timer' for name in TIMERS]
    units += [name + '.service' for name in TIMERS if name.endswith('-deadline')]
    report = {'stage': 'week-renewal-inventory', 'readOnly': True,
              'observedAt': datetime.now(timezone.utc).isoformat(),
              'previousDeadline': OLD_DEADLINE, 'requestedDeadline': NEW_DEADLINE,
              'changesMade': False, 'renewalApplied': False, 'newPaymentStarted': False}
    report['containers'] = [container_inventory(name) for name in CONTAINERS]
    report['database'] = database_inventory(DATABASE, '/nix/var/nix/profiles/default/bin/psql',
                                           'postgres', 'renewal-inventory.sql', SYSTEM)
    report['receiptDatabase'] = database_inventory('pvb-staging-receipts-db', 'psql', 'supabase_admin',
                                                  'renewal-receipt-inventory.sql', RECEIPT_SYSTEM)
    report['files'] = [file_inventory(filename) for filename in FILES]
    report['units'] = []
    for unit in units:
        value = file_inventory('/etc/systemd/system/' + unit)
        properties = command(['/usr/bin/systemctl', 'show', unit, '-p', 'LoadState', '-p', 'ActiveState',
                              '-p', 'SubState', '-p', 'FragmentPath', '-p', 'DropInPaths',
                              '-p', 'NeedDaemonReload', '-p', 'NextElapseUSecRealtime'])
        value['state'] = dict(line.split('=', 1) for line in properties.splitlines() if '=' in line)
        report['units'].append(value)
    return report


def main():
    try:
        report = collect()
    except Exception:
        print(json.dumps({'stage': 'week-renewal-inventory', 'status': 'refused', 'readOnly': True,
                          'changesMade': False, 'renewalApplied': False, 'redacted': True}), flush=True)
        raise SystemExit(1) from None
    print(json.dumps(report, separators=(',', ':')), flush=True)
    print('STAGING_WEEK_RENEWAL_INVENTORY_READY', flush=True)


if __name__ == '__main__':
    main()
