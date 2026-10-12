import argparse
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from constants import BINDING, BINDING_SHA, DEADLINE, EPOCH, EVIDENCE, GATEWAY_UNIT_SHA, GRAPH, GROUP, OLD_SHA, PRESERVED_UNITS, ROOT, SERVICE, SOURCES
from owner_io import ProtectedFiles
from transaction import EvidenceRefresh


def digest(content):
    return hashlib.sha256(content).hexdigest()


class GatewayRecovery:
    def __init__(self, source_pin):
        if sys.platform != 'linux' or os.geteuid() != 0 or HERE.parent != Path('/root'):
            raise ValueError('root_private_bundle_required')
        os.umask(0o077)
        self.files = ProtectedFiles()
        self.files.parents(HERE / 'source-sentinel')
        info = HERE.lstat()
        if (stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != 0 or info.st_gid != 0
                or HERE != HERE.resolve()):
            raise ValueError('owner_directory_metadata')
        raw, _ = self.files.read(HERE / 'SHA256SUMS', (0o600,), (0,), source_pin)
        records = {}
        for line in raw.decode().splitlines():
            match = re.fullmatch(r'([a-f0-9]{64})  ([a-z_.]+)', line)
            if not match or match[2] not in SOURCES or match[2] in records:
                raise ValueError('source_closure')
            records[match[2]] = match[1]
        if set(records) != set(SOURCES):
            raise ValueError('source_closure')
        self.preserved = {}
        for name, expected in records.items():
            self.capture(HERE / name, (0o600,), (0,), expected)
        self.capture(HERE / 'SHA256SUMS', (0o600,), (0,), source_pin)
        for name, expected in GRAPH.items():
            self.capture(ROOT / name, (0o550,) if name == 'managed-inventory-helper.mjs' else (0o440,), (GROUP,), expected)
        self.binding_bytes = self.capture(BINDING, (0o440,), (GROUP,), BINDING_SHA)
        self.binding = json.loads(self.binding_bytes)
        if (self.binding.get('leaseExpiresAt') != DEADLINE
                or len(self.binding.get('identity', {}).get('restRoutes', [])) != 23):
            raise ValueError('binding_deadline_or_routes')
        self.old, self.old_info = self.files.read(EVIDENCE, (0o440,), (GROUP,), OLD_SHA)
        for name in PRESERVED_UNITS:
            if name == SERVICE:
                self.capture(Path('/etc/systemd/system') / name, (0o644,), (0,), GATEWAY_UNIT_SHA)
            else:
                self.capture(Path('/etc/systemd/system') / name, (0o644, 0o444, 0o440), (0, GROUP))
        self.capture(Path('/etc/sudoers.d/baci-savings-gateway'), (0o440,), (0,))
        self.uid = pwd.getpwnam('baci-savings-gateway').pw_uid
        if self.uid == 0 or grp.getgrnam('baci-savings-ingress').gr_gid != GROUP:
            raise ValueError('gateway_account_identity')
        self.backup_directory = None
        self.started_invocation = None

    def capture(self, filename, modes, groups, expected=None):
        content, metadata = self.files.read(filename, modes, groups, expected)
        self.preserved[filename] = (digest(content), metadata, modes, groups)
        return content

    def run(self, arguments, content=None, timeout=25):
        node = ['/usr/bin/node', str(HERE / 'gateway_probe.mjs')]
        allowed = arguments[:len(node)] == node and len(arguments) == 3 and arguments[-1] in ('collect', 'validate', 'verify')
        allowed = allowed or arguments in ([ '/usr/bin/systemctl', 'start', SERVICE ], [ '/usr/bin/systemctl', 'stop', SERVICE ])
        allowed = allowed or (len(arguments) == 5 and arguments[:4] == ['/usr/bin/systemctl', 'show', SERVICE, '--all']
                              and arguments[4].startswith('--property='))
        if not allowed:
            raise ValueError('command_scope')
        result = subprocess.run(arguments, input=content, capture_output=True, timeout=timeout,
            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C', 'HOME': '/root'})
        if result.returncode or len(result.stdout) > 262144:
            raise ValueError('gateway_command_refused')
        return result.stdout

    def state(self):
        keys = ('LoadState', 'ActiveState', 'SubState', 'MainPID', 'InvocationID', 'FragmentPath',
                'DropInPaths', 'NeedDaemonReload', 'User', 'Group', 'Restart', 'ExecStart', 'Environment', 'EnvironmentFiles')
        raw = self.run(['/usr/bin/systemctl', 'show', SERVICE, '--all', '--property=' + ','.join(keys)])
        result = dict(line.split('=', 1) for line in raw.decode().splitlines() if '=' in line)
        self.files.read(Path('/etc/systemd/system') / SERVICE, (0o644,), (0,), GATEWAY_UNIT_SHA)
        command = re.findall(r'argv\[\]=([^;]+)\s*;', result.get('ExecStart', ''))
        if (set(result) not in (set(keys), set(keys) - {'EnvironmentFiles'})
                or result['LoadState'] != 'loaded' or result['DropInPaths']
                or result['NeedDaemonReload'] != 'no' or result['Restart'] != 'no'
                or result['User'] != 'baci-savings-gateway' or result['Group'] != 'baci-savings-ingress'
                or result['FragmentPath'] != '/etc/systemd/system/' + SERVICE
                or result['Environment'] or ('EnvironmentFiles' in result and result['EnvironmentFiles']) or len(command) != 1
                or command[0].split() != ['/usr/bin/node', str(ROOT / 'managed-gateway-cli.mjs'), '--managed']):
            raise ValueError('effective_gateway_unit')
        return result

    def guard(self):
        if time.time() >= EPOCH:
            raise ValueError('oct6_deadline')
        for filename, (expected, before, modes, groups) in self.preserved.items():
            _, current = self.files.read(filename, modes, groups, expected)
            if current != before:
                raise ValueError('preserved_file_changed')
        expected = getattr(self, 'candidate_sha', OLD_SHA)
        _, current = self.files.read(EVIDENCE, (0o440,), (GROUP,), expected)
        before = getattr(self, 'candidate_info', self.old_info)
        if before is not None and current != before:
            raise ValueError('evidence_file_changed')

    def stopped(self):
        value = self.state()
        if value['ActiveState'] not in ('inactive', 'failed') or value['MainPID'] != '0':
            raise ValueError('gateway_must_be_stopped')

    def probe(self, kind, value):
        self.guard()
        content = json.dumps(value, separators=(',', ':')).encode()
        return json.loads(self.run(['/usr/bin/node', str(HERE / 'gateway_probe.mjs'), kind], content, timeout=30))

    def collect(self):
        return json.dumps(self.probe('collect', {'binding': self.binding})['evidence'], separators=(',', ':')).encode()

    def validate(self, candidate):
        result = self.probe('validate', {'binding': self.binding, 'evidence': json.loads(candidate)})
        if result != {'status': 'fresh-evidence-valid'}:
            raise ValueError('gateway_proof_protocol')

    def backup(self, candidate):
        current, metadata = self.files.read(EVIDENCE, (0o440,), (GROUP,), OLD_SHA)
        if current != self.old or metadata != self.old_info:
            raise ValueError('evidence_predecessor_changed')
        self.backup_directory = HERE / ('attempt-' + str(time.time_ns()))
        self.backup_directory.mkdir(mode=0o700)
        self.files.sync(HERE)
        self.files.write(self.backup_directory / 'startup-evidence.original.json', self.old)
        self.files.write(self.backup_directory / 'startup-evidence.candidate.json', candidate)
        summary = {'bindingSha256': BINDING_SHA, 'originalSha256': OLD_SHA, 'candidateSha256': digest(candidate),
            'preserved': {str(filename): expected for filename, (expected, _, _, _) in self.preserved.items()}}
        self.files.write(self.backup_directory / 'proof.json', json.dumps(summary).encode())

    def replace(self, candidate):
        self.stopped()
        self.candidate_sha = digest(candidate)
        self.candidate_info = None
        self.files.replace_evidence(OLD_SHA, candidate, self.old_info)
        _, self.candidate_info = self.files.read(EVIDENCE, (0o440,), (GROUP,), self.candidate_sha)

    def socket(self):
        parent = Path('/run').lstat()
        directory = Path('/run/baci-savings-gateway').lstat()
        socket = Path('/run/baci-savings-gateway/ingress.sock').lstat()
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_mode & 0o022
                or not stat.S_ISDIR(directory.st_mode) or directory.st_uid != self.uid or directory.st_gid != GROUP
                or stat.S_IMODE(directory.st_mode) != 0o750 or not stat.S_ISSOCK(socket.st_mode)
                or socket.st_uid != self.uid or socket.st_gid != GROUP or stat.S_IMODE(socket.st_mode) != 0o660):
            raise ValueError('managed_socket_identity')

    def start(self):
        self.guard()
        self.stopped()
        try:
            self.run(['/usr/bin/systemctl', 'start', SERVICE])
        finally:
            current = self.state()
            self.started_invocation = current['InvocationID']
        started = time.monotonic()
        while time.monotonic() - started < 5:
            self.guard()
            current = self.state()
            if current['ActiveState'] == 'active' and current['MainPID'] != '0':
                try:
                    self.socket()
                    return
                except FileNotFoundError:
                    pass
            elif current['ActiveState'] == 'failed':
                raise ValueError('gateway_start_failed')
            time.sleep(0.1)
        raise ValueError('gateway_start_timeout')

    def verify(self):
        result = self.probe('verify', {})
        current = self.state()
        if (result != {'status': 'unauthenticated-401-verified', 'probes': 6}
                or current['ActiveState'] != 'active' or current['MainPID'] == '0'
                or current['InvocationID'] != self.started_invocation):
            raise ValueError('gateway_postcheck_failed')
        self.socket()

    def stop(self):
        current = self.state()
        if current['MainPID'] != '0':
            if not self.started_invocation or current['InvocationID'] != self.started_invocation:
                raise ValueError('gateway_foreign_invocation')
            self.run(['/usr/bin/systemctl', 'stop', SERVICE])
        self.stopped()

    def restore(self, candidate):
        self.stopped()
        current, _ = self.files.read(EVIDENCE, (0o440,), (GROUP,))
        if digest(current) == OLD_SHA:
            return
        if digest(current) != digest(candidate) or self.backup_directory is None:
            raise ValueError('rollback_evidence_changed')
        saved, _ = self.files.read(self.backup_directory / 'startup-evidence.original.json', (0o600,), (0,), OLD_SHA)
        self.files.replace_evidence(digest(candidate), saved)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source_manifest_sha256')
    parser.add_argument('--apply', action='store_true')
    request = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{64}', request.source_manifest_sha256):
        raise ValueError('source_manifest_pin')
    actions = GatewayRecovery(request.source_manifest_sha256)
    lock = os.open(HERE / 'gateway-fresh.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError('owner_lock_metadata')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = EvidenceRefresh(actions).run(apply=request.apply)
        result.update(bindingSha256=BINDING_SHA, originalEvidenceSha256=OLD_SHA,
                      deadline=DEADLINE, financialMutations=False)
        print(json.dumps(result))
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'fresh-evidence-refused', 'operatorReviewRequired': True}))
        sys.exit(1)
