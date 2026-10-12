import fcntl
import http.client
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from contract import (ACTIVATION, ANON, ARCHIVE, CHECKOUT, CONTAINER_MANIFEST, DEADLINE, DEADLINE_EPOCH,
    FINANCIAL_CONTAINERS, GOAL, LAUNCHER, MANIFEST, OLD_ARCHIVE, OLD_MANIFEST, RECEIPT,
    digest, parsed, prove_anon, prove_mutations_off, prove_protected_state, prove_receipt, renew_checkout,
    renewed_units, serialized)
from public_artifact import validate_archive
from public_app_upgrade_io import sync, verify_app, write_file
from public_install_io import prepare_tree
import public_service_contract as service
from runtime_owner_support import command, database
from treasury_owner_contract import Refused
from treasury_owner_io import read_file, root_ancestors, write_private
from recovery import recover


ROOT = Path(service.ROOT)
SYSTEMD = Path('/etc/systemd/system')


def inspect(name):
    value = parsed(command([*service.DOCKER, 'inspect', name]))
    if not isinstance(value, list) or len(value) != 1:
        raise Refused('container-identity')
    return value[0]


def read(path, mode, limit):
    root_ancestors(path)
    return read_file(path, 0, mode, limit)


def pinned(path, mode, limit, expected):
    content = read(path, mode, limit)
    if digest(content) != expected:
        raise Refused('predecessor-pin')
    return content


def properties(name):
    output = command(['/usr/bin/systemctl', 'show', name, '--property=DropInPaths',
                      '--property=NeedDaemonReload', '--property=FragmentPath',
                      '--property=ActiveState'])
    values = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    if (values.get('DropInPaths') != '' or values.get('NeedDaemonReload') != 'no'
            or values.get('FragmentPath') != str(SYSTEMD / name)):
        raise Refused('effective-unit-contract')
    return values


def financial_off():
    for name in FINANCIAL_CONTAINERS:
        value = inspect(name)
        if value['State']['Running'] is not False or value['HostConfig']['RestartPolicy']['Name'] != 'no':
            raise Refused('financial-runtime-active')
    for name in ('baci-prefunded-background.service', 'baci-prefunded-snapshot.service',
                 'baci-staging-test-payments.service'):
        if properties(name).get('ActiveState') not in ('inactive', 'failed'):
            raise Refused('financial-service-active')


def replace_file(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix='.readonly-public-', dir=path.parent)
    with os.fdopen(descriptor, 'wb') as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), 0o644)
    os.replace(temporary, path)
    sync(path.parent)


def loopback_probes():
    for method, path, expected in service.probe_contract():
        connection = http.client.HTTPConnection('127.0.0.1', 4800, timeout=8)
        try:
            connection.request(method, path, body=b'{}' if method in ('POST', 'PATCH', 'PUT') else None,
                headers={'Host': 'staging.ogabassey.com', 'Content-Type': 'application/json'})
            response = connection.getresponse()
            content = response.read(4194305)
            if response.status != expected or len(content) > 4194304:
                raise Refused('loopback-http-contract')
            if expected == 401 and not isinstance(parsed(content), dict):
                raise Refused('loopback-json-contract')
        finally:
            connection.close()


def prove_container(manifest, running):
    observed = inspect(service.NAME)
    image = parsed(command([*service.DOCKER, 'image', 'inspect', service.IMAGE]))
    if len(image) != 1 or image[0].get('Id') != service.IMAGE:
        raise Refused('image-pin')
    prove_mutations_off(image[0]['Config']['Env'])
    service.validate_container(observed, manifest, image[0]['Config']['Env'])
    if observed['State']['Running'] is not running:
        raise Refused('public-running-state')


def create_container(manifest):
    command([*service.DOCKER, *service.create_arguments(manifest)])
    command([*service.DOCKER, 'network', 'connect', service.NETWORKS[1], service.NAME])
    prove_container(manifest, False)


def snapshot(sql):
    value = parsed(database(sql.decode()))
    return prove_protected_state(value)


def preflight(bundle):
    if os.getuid() != 0 or not 0 < DEADLINE_EPOCH - time.time() <= 7 * 86400:
        raise Refused('owner-or-deadline')
    old_source = Path('/root/baci-checkout-retirement.jYwPj98w')
    old_files = validate_archive(read(old_source / 'public-app.tar.gz', 0o600, 268435456),
        read(old_source / 'public-app.manifest.json', 0o600, 16777216), OLD_ARCHIVE, OLD_MANIFEST)
    files = validate_archive(read(bundle / 'public-app.tar.gz', 0o600, 268435456),
        read(bundle / 'public-app.manifest.json', 0o600, 16777216), ARCHIVE, MANIFEST)
    if digest(files['launch-public.cjs']) != LAUNCHER:
        raise Refused('readonly-launcher-pin')
    verify_app(ROOT / 'app', old_files, 0, 0, lambda path, mode, limit: read(path, mode, limit))
    activation = pinned(Path('/etc/baci/prefunded-card/activation.prepared.json'), 0o600, 65536, ACTIVATION)
    checkout = pinned(ROOT / 'config/checkout.json', 0o440, 65536, CHECKOUT)
    anon = pinned(ROOT / 'config/anon.json', 0o440, 16384, ANON)
    receipt = prove_receipt(pinned(ROOT / 'receipt.json', 0o600, 65536, RECEIPT))
    prove_anon(anon, inspect('baci-isolated-savings-auth-1'), time.time())
    config = renew_checkout(activation, checkout)
    original_units = {name: content.encode() for name, content in service.units().items()}
    new_units = renewed_units()
    for name, content in original_units.items():
        properties(name)
        if read(SYSTEMD / name, 0o644, 32768) != content or read(ROOT / 'units' / name, 0o644, 32768) != content:
            raise Refused('predecessor-unit-pin')
    prove_container(CONTAINER_MANIFEST, False)
    financial_off()
    sql = read(bundle / 'app-baseline.sql', 0o600, 65536)
    before = snapshot(sql)
    return files, config, anon, receipt, original_units, new_units, sql, before


def activate(bundle):
    files, config, anon, receipt, original_units, new_units, sql, before = preflight(bundle)
    audit = Path(tempfile.mkdtemp(prefix='baci-public-readonly.', dir='/root'))
    candidate = Path(tempfile.mkdtemp(prefix=ROOT.name + '.readonly-', dir=ROOT.parent))
    candidate.rmdir()
    retained = ROOT.parent / (ROOT.name + '.before-readonly-' + audit.name)
    next_receipt = serialized({**receipt, 'deadline': DEADLINE,
        'archiveSha256': ARCHIVE, 'manifestSha256': MANIFEST,
        'checkoutSha256': digest(config), 'anonSha256': ANON,
        'predecessorArchiveSha256': OLD_ARCHIVE, 'predecessorManifestSha256': OLD_MANIFEST,
        'rollbackPath': str(retained), 'mutationsEnabled': False})
    tree = {**{'app/' + name: content for name, content in files.items()},
            'config/checkout.json': config, 'config/anon.json': anon,
            **{'units/' + name: content for name, content in new_units.items()}}
    prepare_tree(candidate, tree, next_receipt)
    command(['/usr/bin/systemd-analyze', 'verify', *[str(candidate / 'units' / name) for name in new_units]])
    moved = False
    removed = False
    try:
        command(['/usr/bin/systemctl', 'stop', service.NAME + '-deadline.timer'])
        prove_container(CONTAINER_MANIFEST, False)
        os.rename(ROOT, retained)
        moved = True
        os.rename(candidate, ROOT)
        sync(ROOT.parent)
        command([*service.DOCKER, 'rm', service.NAME])
        removed = True
        create_container(MANIFEST)
        for name, content in new_units.items():
            replace_file(SYSTEMD / name, content)
        command(['/usr/bin/systemctl', 'daemon-reload'])
        command(['/usr/bin/systemctl', 'start', service.NAME + '-deadline.timer'])
        timer = command(['/usr/bin/systemctl', 'show', service.NAME + '-deadline.timer',
                         '--property=ActiveState', '--property=NextElapseUSecRealtime'])
        if 'ActiveState=active' not in timer or '2026-10-06 15:59:10' not in timer:
            raise Refused('effective-deadline')
        if time.time() >= DEADLINE_EPOCH:
            raise Refused('deadline-before-start')
        command(['/usr/bin/systemctl', 'start', service.NAME + '.service'])
        for _attempt in range(15):
            try:
                loopback_probes()
                break
            except (OSError, Refused):
                time.sleep(1)
        else:
            raise Refused('public-startup-probes')
        prove_container(MANIFEST, True)
        financial_off()
        if snapshot(sql) != before:
            raise Refused('protected-state-changed')
        prepare_tree(ROOT, tree, next_receipt, verify_only=True)
        report = dict(status='readonly-first-card-public-active', deadline=DEADLINE,
            mutationsEnabled=False, databaseApplied=False, newPaymentStarted=False,
            principalKobo=10000, manifestSha256=MANIFEST, protectedStateUnchanged=True,
            authenticatedCustomerVerified=False, financialReplayEnabled=False,
            cardPaymentsEnabled=False, backup=str(retained), audit=str(audit))
        write_private(audit / 'result.json', serialized(report))
        return report
    except Exception:
        recovery_errors = recover(retained, audit, moved, removed, original_units,
            inspect, command, replace_file, create_container, MANIFEST, CONTAINER_MANIFEST)
        write_private(audit / 'recovery.json', serialized(dict(recoveryErrors=recovery_errors,
            cardPaymentsEnabled=False, newPaymentStarted=False)))
        raise


if __name__ == '__main__':
    try:
        if len(sys.argv) not in (2, 3) or len(sys.argv) == 3 and sys.argv[2] != '--check':
            raise Refused('arguments')
        descriptor = os.open('/run/lock/baci-public-readonly.lock',
            os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if len(sys.argv) == 3:
            preflight(Path(sys.argv[1]))
            print(serialized(dict(status='readonly-public-preflight-ready', readOnly=True,
                databaseApplied=False, cardPaymentsEnabled=False, newPaymentStarted=False)).decode())
        else:
            print(serialized(activate(Path(sys.argv[1]))).decode())
    except Exception as error:
        reason = str(error) if isinstance(error, Refused) and re.fullmatch('[a-z0-9-]{1,64}', str(error)) else None
        frame = traceback.extract_tb(error.__traceback__)[-1]
        print(serialized(dict(status='readonly-public-refused', redacted=True,
            errorType=type(error).__name__, reasonCode=reason, cardPaymentsEnabled=False,
            sourceModule=Path(frame.filename).name, sourceLine=frame.lineno,
            newPaymentStarted=False)).decode())
        raise SystemExit(1)
