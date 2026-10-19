import argparse
import copy
from datetime import datetime, timezone
import fcntl
import grp
import os
from pathlib import Path
import pwd
import re
import stat
import sys
import time

from activation_owner import CANDIDATES, PREPARATION, SOURCES as EVIDENCE_SOURCES, collect, physical_snapshot
from connectivity_contract import (EVIDENCE_BUNDLE_SHA256, REPORT_PATH, REPORT_SHA256, TIMERS,
                                   TARGET, validate_fresh, stop_targets)
from connectivity_io import replace_owned
from connectivity_runtime import Runtime, effective_stop, http, show
from connectivity_transaction import execute
from renewal_contract import BINDING, EVIDENCE, FUNDING_ENV, PINS, TARGET_EPOCH, UNIT_DIRECTORY, Refused, canonical, digest, parse_json
from renewal_io import private_directory, read_verified, trusted_parents, write_private
from renewal_owner import source_policy


HERE = Path(__file__).resolve().parent
NEW_SOURCES = ('connectivity_owner.py', 'connectivity_contract.py', 'connectivity_io.py',
               'connectivity_runtime.py', 'connectivity_transaction.py', 'connectivity_role.py',
               'connectivity-role.sql', 'connectivity_listeners.py', 'gateway-proof.mjs',
               'README-connectivity.md', 'ACTIVATION_SHA256SUMS')
SOURCES = EVIDENCE_SOURCES + NEW_SOURCES
TARGETS = {name: (BINDING if name == 'binding.preview.json' else FUNDING_ENV if name == 'funding-service.env'
                  else UNIT_DIRECTORY + name) for name in CANDIDATES}
LOCK = Path('/etc/baci-savings-gateway/week-renewal.lock')
STAGE = 'preflight'


def verify_bundle(expected):
    if (os.geteuid() != 0 or HERE.parent != Path('/root')
            or re.fullmatch(r'[a-f0-9]{64}', expected) is None):
        raise Refused('connectivity-root-bundle')
    trusted_parents(HERE)
    private_directory(HERE)
    manifest, _ = read_verified(HERE / 'CONNECTIVITY_SHA256SUMS', (0o400,), (0,), expected, limit=8192)
    records = {}
    for line in manifest.decode().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([A-Za-z0-9_.-]+)', line)
        if not match or match[2] not in SOURCES or match[2] in records:
            raise Refused('connectivity-source-closure')
        records[match[2]] = match[1]
    if set(records) != set(SOURCES) or {item.name for item in HERE.iterdir()} != set(SOURCES) | {'CONNECTIVITY_SHA256SUMS'}:
        raise Refused('connectivity-source-closure')
    for name, expected_hash in records.items():
        read_verified(HERE / name, (0o400,), (0,), expected_hash)


class Actions:
    @property
    def stage(self):
        return STAGE

    @stage.setter
    def stage(self, value):
        global STAGE
        STAGE = value
        print(canonical({'stage': 'connectivity-' + value}).decode(), flush=True)

    def __init__(self, directory):
        self.directory = directory
        self.runtime = Runtime()
        self.installed = []
        self.role_bound = False
        self.ingress_gid = grp.getgrnam('baci-savings-ingress').gr_gid
        self.funding_gid = grp.getgrnam('baci-savings-funding').gr_gid
        self.ingress_uid = pwd.getpwnam('baci-savings-gateway').pw_uid

    def preflight(self):
        report, _ = read_verified(REPORT_PATH, (0o600,), (0,), REPORT_SHA256)
        self.reviewed = parse_json(report)
        fresh = collect(HERE, EVIDENCE_BUNDLE_SHA256)
        validate_fresh(self.reviewed, fresh, time.time())
        if time.time() + 180 >= TARGET_EPOCH:
            raise Refused('connectivity-deadline-near')
        self.contents, self.metadata = {}, {}
        for path, expected in PINS.items():
            modes, groups = source_policy(path, self.ingress_gid, self.funding_gid)
            self.contents[path], self.metadata[path] = read_verified(path, modes, groups, expected)
        self.prepared = {name: read_verified(PREPARATION / 'candidate' / name, (0o600,), (0,))[0] for name in CANDIDATES}
        self.stop_commands = {}
        for timer in TIMERS:
            name = timer.replace('.timer', '.service')
            arguments = stop_targets(self.contents[UNIT_DIRECTORY + name], name)
            effective_stop(show(name, ('ExecStart',))['ExecStart'], arguments)
            self.stop_commands[name] = arguments
        self.before_snapshot = physical_snapshot()
        write_private(self.directory / 'preflight.json', canonical(fresh))
        backup = self.directory / 'originals'
        backup.mkdir(mode=0o700)
        for index, (path, content) in enumerate(self.contents.items()):
            write_private(backup / f'{index:02d}-{Path(path).name}', content)
        self.webhook_baseline = http('https://staging-auth.ogabassey.com/piggyvest/intake')
        if self.webhook_baseline != 405:
            raise Refused('connectivity-webhook-baseline')

    def assert_snapshot(self, bounded=False):
        expected = copy.deepcopy(self.before_snapshot)
        if bounded:
            expected[2]['role']['expiresAtEpoch'] = TARGET_EPOCH
        actual = physical_snapshot()
        if actual != expected:
            raise Refused('connectivity-protected-snapshot')
        return actual

    def stop(self):
        self.runtime.stop()
        self.assert_snapshot()

    def rehearse_role(self):
        value = self.runtime.role_sql(False)
        if value.get('passwordUnchanged') is not True or value.get('expiresAt') != TARGET:
            raise Refused('connectivity-role-rehearsal')
        self.assert_snapshot()

    def bind_role(self):
        self.role_bound = True
        value = self.runtime.role_sql(True)
        if value.get('passwordUnchanged') is not True or value.get('expiresAt') != TARGET:
            raise Refused('connectivity-role-binding')
        self.assert_snapshot(True)

    def swap(self, path, content):
        metadata = self.metadata[path]
        record = (path, self.contents[path], digest(content), stat.S_IMODE(metadata.st_mode), metadata.st_gid)
        self.installed.append(record)
        write_private(self.directory / f'write-{len(self.installed):02d}.json', canonical({
            'path': path, 'beforeSha256': digest(record[1]), 'afterSha256': record[2],
            'mode': f'{record[3]:04o}', 'gid': record[4]}))
        replace_owned(path, digest(record[1]), content, record[3], record[4])

    def install(self):
        for name in CANDIDATES:
            self.swap(TARGETS[name], self.prepared[name])

    def arm_deadlines(self):
        self.runtime.reload()
        self.runtime.deadlines(self.stop_commands)
        self.assert_snapshot(True)

    def fresh_evidence(self):
        from activation_owner import readonly_probe, upstream_inputs
        self.assert_graph()
        binding = parse_json(self.prepared['binding.preview.json'])
        _, upstreams = upstream_inputs(binding['identity'])
        if any(value.get('healthHttp') != 200 for value in upstreams.values()):
            raise Refused('connectivity-upstream-health')
        for bridge in ('baci-stg-db', 'baci-stg-mail'):
            status, _ = readonly_probe(['/usr/sbin/iptables', '-w', '5', '-C', 'INPUT', '-i', bridge,
                                        '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment',
                                        '--comment', 'baci-isolated-savings', '-j', 'DROP'])
            if status != 0:
                raise Refused('connectivity-firewall')
        verified_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        inventory = self.runtime.inventory()
        evidence = {'receipt': {'version': 1, **binding['identity'], 'verifiedAt': verified_at,
                                'firewallVerified': True, 'hostReachabilityVerified': True}, 'inventory': inventory}
        self.runtime.check_gateway(canonical({'binding': binding, 'input': evidence}))
        self.swap(EVIDENCE, canonical(evidence))

    def start(self):
        self.assert_graph()
        self.runtime.start()

    def assert_graph(self):
        for record in self.reviewed['gatewayGraph']:
            read_verified('/opt/baci-savings-gateway/' + record['name'],
                          (int(record['mode'], 8),), (record['gid'],), record['sha256'])

    def verify(self):
        self.checks = self.runtime.verify(self.ingress_uid, self.ingress_gid)
        self.runtime.deadlines(self.stop_commands)
        if http('https://staging-auth.ogabassey.com/piggyvest/intake') != self.webhook_baseline:
            raise Refused('connectivity-webhook-drift')
        self.assert_snapshot(True)
        self.assert_graph()
        written = {path: (expected, mode, group) for path, _, expected, mode, group in self.installed}
        for path, old_hash in PINS.items():
            modes, groups = source_policy(path, self.ingress_gid, self.funding_gid)
            expected = written[path][0] if path in written else old_hash
            read_verified(path, modes, groups, expected)

    def finish(self):
        result = {'status': 'connectivity-renewed', 'renewalApplied': True, 'deadline': TARGET,
                  'fundingRoleDeadlineBound': True, 'passwordChanged': False, 'routes': 23,
                  'principalKobo': 10000, 'approvedBudgetKobo': 10000, 'newPaymentStarted': False,
                  'financialReplayEnabled': False, 'paidInterestBridgeEnabled': False,
                  'authenticatedCustomerVerified': False, 'phoneReady': False, 'checks': self.checks,
                  'auditDirectory': str(self.directory)}
        write_private(self.directory / 'result.json', canonical(result))
        return result

    def recover(self):
        try:
            self.runtime.stop()
            for path, original, expected, mode, group in reversed(self.installed):
                content, _ = read_verified(path, (mode,), (group,))
                if digest(content) == digest(original):
                    continue
                if digest(content) != expected:
                    raise Refused('connectivity-foreign-recovery-state')
                replace_owned(path, expected, original, mode, group)
            self.runtime.reload()
            self.runtime.stop()
            actual = physical_snapshot()
            role_bounded = copy.deepcopy(self.before_snapshot[2])
            role_bounded['role']['expiresAtEpoch'] = TARGET_EPOCH
            if (actual[:2] != self.before_snapshot[:2]
                    or actual[2] not in (self.before_snapshot[2], role_bounded)):
                raise Refused('connectivity-recovery-snapshot')
            write_private(self.directory / 'recovery.json', canonical({
                'status': 'fail-stopped', 'filesRestored': True, 'fundingRoleMayBeDeadlineBound': self.role_bound,
                'financialReplayEnabled': False, 'newPaymentStarted': False}))
        except BaseException:
            raise Refused('connectivity-recovery-unconfirmed') from None


def run(expected):
    verify_bundle(expected)
    trusted_parents(LOCK)
    descriptor = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'rb+') as handle:
        value = os.fstat(handle.fileno())
        if (not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_gid != 0
                or value.st_nlink != 1 or stat.S_IMODE(value.st_mode) != 0o600):
            raise Refused('connectivity-lock')
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return execute(Actions(HERE))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle-sha256', required=True)
    arguments = parser.parse_args()
    try:
        result = run(arguments.bundle_sha256)
    except BaseException as error:
        reason = error.args[0] if isinstance(error, Refused) and error.args else ''
        safe_code = reason if isinstance(reason, str) and re.fullmatch(r'(connectivity|deadline)-[a-z-]+', reason) else 'redacted-check'
        location = {'sourceModule': None, 'sourceLine': None}
        traceback = error.__traceback__
        while traceback is not None:
            filename = Path(traceback.tb_frame.f_code.co_filename).absolute()
            if filename.parent == HERE and filename.name in SOURCES:
                location.update(sourceModule=filename.name, sourceLine=traceback.tb_lineno)
            traceback = traceback.tb_next
        print(canonical({'stage': 'connectivity-' + STAGE, 'status': 'refused', 'redacted': True,
                         'reasonCode': safe_code, **location,
                         'renewalApplied': None, 'databaseApplied': None, 'newPaymentStarted': False,
                         'phoneReady': False, 'ownerAuditRequired': True}).decode(), flush=True)
        return 1
    print(canonical(result).decode(), flush=True)
    print('STAGING_CONNECTIVITY_RENEWED', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
