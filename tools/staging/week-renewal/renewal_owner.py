import argparse
import fcntl
import grp
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

from renewal_contract import (
    BINDING, EVIDENCE, FUNDING_ENV, GATEWAY_CODE, GATEWAY_TARGET, GATES,
    PINS, PROTECTED_CONTAINERS, PROTECTED_SERVICES, PROTECTED_TIMERS,
    TARGET, UNIT_DIRECTORY, Refused, candidates, canonical, digest,
    inventory_summary, parse_json,
)
from renewal_io import (
    identity, private_directory, publish_preparation, read_verified,
    trusted_parents, unchanged,
)
from renewal_diagnostic import failure_diagnostic


HERE = Path(__file__).resolve().parent
INVENTORY = Path('/root/baci-week-renewal-inventory.BPBuOXTq/inventory-result.txt')
SOURCE_NAMES = ('renewal_contract.py', 'renewal_io.py', 'renewal_owner.py', 'renewal_diagnostic.py', 'README.md')
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}
STATE_KEYS = ('LoadState', 'ActiveState', 'SubState', 'MainPID', 'FragmentPath',
              'DropInPaths', 'NeedDaemonReload', 'UnitFileState')


def readonly_command(arguments):
    allowed = (arguments[:2] == ['/usr/bin/systemctl', 'show'] or
               arguments[:4] == ['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'inspect', '--format'])
    if not allowed:
        raise Refused('non-readonly-command')
    result = subprocess.run(arguments, env=ENVIRONMENT, capture_output=True, timeout=10)
    if result.returncode or len(result.stdout) > 65536:
        raise Refused('readonly-command-refused')
    return result.stdout.decode('utf-8')


def boundary_states():
    states = {}
    units = tuple(Path(path).name for path in PINS if path.startswith(UNIT_DIRECTORY))
    units += PROTECTED_SERVICES + PROTECTED_TIMERS
    for name in units:
        expected_keys = tuple(key for key in STATE_KEYS if key != 'MainPID' or name.endswith('.service'))
        output = readonly_command(['/usr/bin/systemctl', 'show', name, '--property=' + ','.join(expected_keys)])
        value = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
        if (set(value) != set(expected_keys) or value['LoadState'] != 'loaded'
                or value['FragmentPath'] != UNIT_DIRECTORY + name or value['DropInPaths']
                or value['NeedDaemonReload'] != 'no' or value['UnitFileState'] not in ('static', 'enabled', 'disabled')):
            raise Refused('effective-unit-contract')
        if name in PROTECTED_SERVICES + PROTECTED_TIMERS:
            if value['ActiveState'] not in ('inactive', 'failed') or name.endswith('.service') and value['MainPID'] != '0':
                raise Refused('protected-b-runtime-not-stopped')
        if name in ('baci-savings-gateway.service', 'baci-savings-drafts.service'):
            if value['ActiveState'] not in ('inactive', 'failed') or value['MainPID'] != '0':
                raise Refused('expired-a-runtime-not-stopped')
        states[name] = value
    for name in PROTECTED_CONTAINERS:
        content = readonly_command(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'inspect', '--format',
                                    '{{json .Name}} {{json .State.Running}} {{json .State.Restarting}} {{json .HostConfig.RestartPolicy}}', name])
        expected = '"/' + name + '" false false {"Name":"no","MaximumRetryCount":0}'
        if content.strip() != expected:
            raise Refused('protected-b-container-not-stopped')
        states[name] = {'running': False, 'restarting': False, 'restartPolicy': 'no'}
    return states


def verify_source_bundle(directory, expected):
    if not re.fullmatch('[a-f0-9]{64}', expected):
        raise Refused('bundle-pin-required')
    content, _ = read_verified(directory / 'SHA256SUMS', (0o400, 0o600), (0,), expected, limit=4096)
    lines = content.decode().splitlines()
    if len(lines) != len(SOURCE_NAMES):
        raise Refused('bundle-source-closure')
    records = {}
    for line in lines:
        match = re.fullmatch('([a-f0-9]{64})  ([a-zA-Z_.]+)', line)
        if not match or match[2] not in SOURCE_NAMES or match[2] in records:
            raise Refused('bundle-source-closure')
        records[match[2]] = match[1]
    for name, expected_hash in records.items():
        read_verified(directory / name, (0o400, 0o600), (0,), expected_hash)


def source_policy(path, ingress, funding):
    if path.startswith(UNIT_DIRECTORY):
        return (0o644,), (0,)
    if path in (BINDING, EVIDENCE, GATEWAY_CODE):
        return (0o440,), (ingress,)
    if path == FUNDING_ENV:
        return (0o400, 0o600, 0o440, 0o640), (0, funding)
    raise Refused('unreviewed-source-path')


def preparation_record(directory, contents, metadata, prepared, report, states, now_ms):
    originals = {str(position).zfill(2) + '-' + Path(path).name: content
                 for position, (path, content) in enumerate(contents.items())}
    sources = []
    for position, (path, content) in enumerate(contents.items()):
        info = metadata[path]
        sources.append({'path': path, 'sha256': digest(content),
                        'backup': str(position).zfill(2) + '-' + Path(path).name,
                        'uid': info.st_uid, 'gid': info.st_gid, 'mode': f'{stat.S_IMODE(info.st_mode):04o}',
                        'size': info.st_size, 'nlink': info.st_nlink})
    receipt = {'version': 1, 'stage': 'lane-a-preparation', 'status': 'prepared-review-required',
               'activationReady': False, 'renewalApplied': False, 'liveChangesMade': False,
               'newPaymentStarted': False, 'databaseApplied': False,
               'requestedServiceDeadline': TARGET, 'requestedGatewayDeadline': GATEWAY_TARGET,
               'preparedAtEpochMs': now_ms, 'startupEvidenceGenerated': False,
               'sources': sources, 'candidateSha256': {name: digest(content) for name, content in prepared.items()},
               'identitySha256': digest(canonical(parse_json(contents[BINDING])['identity'])),
               'routesSha256': digest(canonical(parse_json(contents[BINDING])['identity']['restRoutes'])),
               'inventorySha256': report[0], 'invariants': report[1], 'observedStates': states,
               'activationRefusals': list(GATES)}
    return originals, canonical(receipt)


def checked_candidates(ingress, funding, now_ms):
    contents, metadata = {}, {}
    for path, expected in PINS.items():
        modes, groups = source_policy(path, ingress, funding)
        contents[path], metadata[path] = read_verified(path, modes, groups, expected)
    prepared = candidates(contents, now_ms)
    return contents, metadata, prepared


def prepare_locked(directory, report, ingress, funding, now_ms):
    contents, metadata, prepared = checked_candidates(ingress, funding, now_ms)
    before = boundary_states()
    for path, info in metadata.items():
        unchanged(path, info)
    originals, receipt = preparation_record(directory, contents, metadata, prepared, report, before, now_ms)
    output = publish_preparation(directory, originals, prepared, receipt)
    for path, info in metadata.items():
        unchanged(path, info)
    if boundary_states() != before:
        raise Refused('runtime-state-changed-preparation-retained')
    return output, receipt


def verified_context(directory, bundle_sha256):
    directory = Path(directory)
    if os.geteuid() != 0 or directory != HERE or directory.parent != Path('/root'):
        raise Refused('root-private-owner-bundle-required')
    trusted_parents(directory)
    private_directory(directory)
    verify_source_bundle(directory, bundle_sha256)
    report_bytes, _ = read_verified(INVENTORY, (0o400, 0o600), (0,), limit=3000000)
    report = (digest(report_bytes), inventory_summary(report_bytes))
    ingress = grp.getgrnam('baci-savings-ingress').gr_gid
    funding = grp.getgrnam('baci-savings-funding').gr_gid
    return report, ingress, funding


def diagnose(directory, bundle_sha256):
    _, ingress, funding = verified_context(directory, bundle_sha256)
    _, metadata, _ = checked_candidates(ingress, funding, time.time_ns() // 1000000)
    before = boundary_states()
    for path, info in metadata.items():
        unchanged(path, info)
    if boundary_states() != before:
        raise Refused('runtime-state-changed-preparation-retained')
    return {'stage': 'lane-a-diagnostic', 'status': 'checks-passed', 'readOnly': True,
            'renewalApplied': False, 'liveChangesMade': False, 'newPaymentStarted': False,
            'databaseApplied': False, 'activationReady': False}


def prepare(directory, bundle_sha256):
    directory = Path(directory)
    report, ingress, funding = verified_context(directory, bundle_sha256)
    descriptor = os.open(directory / 'prepare.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'rb+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
            raise Refused('preparation-lock-metadata')
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        now_ms = time.time_ns() // 1000000
        output, receipt = prepare_locked(directory, report, ingress, funding, now_ms)
    return {'stage': 'lane-a-preparation', 'status': 'prepared-review-required',
            'activationReady': False, 'renewalApplied': False, 'liveChangesMade': False,
            'newPaymentStarted': False, 'databaseApplied': False,
            'preparationPath': str(output), 'receiptSha256': digest(receipt),
            'requestedServiceDeadline': TARGET, 'requestedGatewayDeadline': GATEWAY_TARGET,
            'activationRefusals': list(GATES)}


def main():
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--prepare', action='store_true')
    action.add_argument('--diagnose', action='store_true')
    parser.add_argument('--bundle-sha256')
    arguments = parser.parse_args()
    if not arguments.prepare and not arguments.diagnose:
        print(json.dumps({'stage': 'lane-a-activation', 'status': 'refused', 'code': 'activation-not-implemented',
                          'renewalApplied': False, 'newPaymentStarted': False, 'databaseApplied': False}), flush=True)
        return 2
    try:
        function = diagnose if arguments.diagnose else prepare
        result = function(HERE, arguments.bundle_sha256 or '')
    except Exception as error:
        print(json.dumps({'stage': 'lane-a-diagnostic' if arguments.diagnose else 'lane-a-preparation',
                          'status': 'refused', 'redacted': True,
                          **failure_diagnostic(error),
                          'readOnly': arguments.diagnose,
                          'renewalApplied': False, 'liveChangesMade': False,
                          'newPaymentStarted': False, 'databaseApplied': False}), flush=True)
        return 1
    print(json.dumps(result, separators=(',', ':')), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
