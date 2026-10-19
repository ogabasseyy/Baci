import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from types import ModuleType

HERE = Path(__file__).resolve().parent
SOURCES = ('owner.py', 'owner_io.py', 'transaction.py', 'constants.py',
           'gateway_probe.mjs', 'endpoint_refresh.py', 'endpoint_probe.mjs')


def authenticate(pin):
    if sys.platform != 'linux' or os.geteuid() != 0 or HERE.parent != Path('/root'):
        raise ValueError('root_private_bundle_required')
    for directory in (HERE, *HERE.parents):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('source_parent')
    if HERE.stat().st_gid != 0 or stat.S_IMODE(HERE.stat().st_mode) != 0o700:
        raise ValueError('source_directory')

    def fingerprint(info):
        return tuple(getattr(info, name) for name in ('st_dev', 'st_ino', 'st_mode', 'st_uid',
            'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))

    def read(name):
        target = HERE / name
        before = target.lstat()
        descriptor = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, 'rb') as handle:
            opened = os.fstat(handle.fileno())
            if (not stat.S_ISREG(opened.st_mode) or opened.st_uid != 0 or opened.st_gid != 0
                    or opened.st_nlink != 1 or stat.S_IMODE(opened.st_mode) != 0o600
                    or not 0 < opened.st_size <= 262144 or fingerprint(before) != fingerprint(opened)):
                raise ValueError('source_metadata')
            content = handle.read(262145)
            if (fingerprint(opened) != fingerprint(os.fstat(handle.fileno()))
                    or fingerprint(opened) != fingerprint(target.lstat()) or len(content) != opened.st_size):
                raise ValueError('source_race')
        return content

    manifest = read('SHA256SUMS')
    if not re.fullmatch('[a-f0-9]{64}', pin) or hashlib.sha256(manifest).hexdigest() != pin:
        raise ValueError('source_manifest_pin')
    entries = {}
    for line in manifest.decode().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([a-z_.]+)', line)
        if not match or match[2] not in SOURCES or match[2] in entries:
            raise ValueError('source_closure')
        entries[match[2]] = match[1]
    if set(entries) != set(SOURCES):
        raise ValueError('source_closure')
    authenticated = {}
    for name, expected in entries.items():
        authenticated[name] = read(name)
        if hashlib.sha256(authenticated[name]).hexdigest() != expected:
            raise ValueError('source_bytes')
    return authenticated


def load_runtime(authenticated):
    names = ('constants', 'owner_io', 'transaction', 'owner')
    if any(name in sys.modules for name in names):
        raise ValueError('preloaded_local_runtime')
    try:
        for name in names:
            filename = str(HERE / (name + '.py'))
            module = ModuleType(name)
            module.__file__ = filename
            sys.modules[name] = module
            exec(compile(authenticated[name + '.py'], filename, 'exec'), module.__dict__)
        return sys.modules['owner']
    except Exception:
        for name in names:
            sys.modules.pop(name, None)
        raise ValueError('authenticated_runtime_refused') from None


def run_transition(actions, apply=False):
    actions.guard()
    actions.stopped()
    candidate = actions.collect()
    actions.validate_candidate(candidate)
    actions.guard()
    if not apply:
        return {'status': 'endpoint-preflight-only', 'applied': False, 'financialMutations': False}
    actions.backup(candidate)
    started = False
    try:
        actions.guard()
        actions.replace(candidate)
        actions.validate_installed(candidate)
        actions.guard()
        started = True
        actions.start()
        actions.verify()
        actions.guard()
        return {'status': 'endpoint-refresh-applied', 'applied': True, 'financialMutations': False}
    except Exception:
        try:
            if started:
                actions.stop()
            actions.restore(candidate)
        except Exception:
            raise ValueError('endpoint_rollback_operator_required') from None
        raise ValueError('endpoint_refresh_refused') from None


def recovery(pin):
    owner = load_runtime(authenticate(pin))
    constants = sys.modules['constants']
    BINDING, EVIDENCE, GROUP, OLD_SHA = constants.BINDING, constants.EVIDENCE, constants.GROUP, constants.OLD_SHA
    owner.SOURCES = SOURCES

    class EndpointRecovery(owner.GatewayRecovery):
        def __init__(self):
            super().__init__(pin)
            self.originals = {BINDING: (self.binding_bytes, self.preserved[BINDING][1]),
                              EVIDENCE: (self.old, self.old_info)}
            self.owned = dict(self.originals)

        def endpoint(self):
            result = subprocess.run(['/usr/bin/node', str(HERE / 'endpoint_probe.mjs')],
                input=json.dumps({'binding': self.binding}).encode(), capture_output=True,
                timeout=30, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
            if result.returncode or len(result.stdout) > 262144:
                raise ValueError('endpoint_probe_refused')
            return json.loads(result.stdout)

        def collect(self):
            self.guard()
            value = self.endpoint()
            if set(value) != {'binding', 'evidence'}:
                raise ValueError('endpoint_payload')
            unchanged = json.loads(json.dumps(value['binding']))
            for name in ('auth', 'rest'):
                unchanged['identity']['containers'][name]['endpointId'] = self.binding['identity']['containers'][name]['endpointId']
            if unchanged != self.binding:
                raise ValueError('endpoint_scope')
            return {name: json.dumps(content, separators=(',', ':')).encode() for name, content in value.items()}

        def validate_candidate(self, candidate):
            previous = self.binding
            try:
                self.binding = json.loads(candidate['binding'])
                self.validate(candidate['evidence'])
            finally:
                self.binding = previous

        def backup(self, candidate):
            self.guard()
            self.backup_directory = HERE / ('attempt-endpoint-' + str(time.time_ns()))
            self.backup_directory.mkdir(mode=0o700)
            self.files.sync(HERE)
            proof = {'bindingOriginalSha256': owner.digest(self.binding_bytes),
                     'evidenceOriginalSha256': OLD_SHA, 'financialMutations': False,
                     'preserved': {str(path): entry[0] for path, entry in self.preserved.items()}}
            for label, path in (('binding', BINDING), ('evidence', EVIDENCE)):
                self.files.write(self.backup_directory / (label + '.original.json'), self.originals[path][0])
                self.files.write(self.backup_directory / (label + '.candidate.json'), candidate[label])
                proof[label + 'CandidateSha256'] = owner.digest(candidate[label])
            self.files.write(self.backup_directory / 'proof.json', json.dumps(proof).encode())

        def check_owned(self):
            for path, (content, fingerprint) in self.owned.items():
                actual, metadata = self.files.read(path, (0o440,), (GROUP,), owner.digest(content))
                if actual != content or metadata != fingerprint:
                    raise ValueError('endpoint_foreign_target')

        def target(self, path, content):
            self.guard()
            self.stopped()
            self.check_owned()
            descriptor, temporary = tempfile.mkstemp(prefix='.endpoint-', dir=path.parent)
            try:
                with os.fdopen(descriptor, 'wb') as handle:
                    handle.write(content)
                    handle.flush()
                    os.fchown(handle.fileno(), 0, GROUP)
                    os.fchmod(handle.fileno(), 0o440)
                    os.fsync(handle.fileno())
                self.check_owned()
                self.guard()
                self.stopped()
                self.check_owned()
                os.replace(temporary, path)
                actual, metadata = self.files.read(path, (0o440,), (GROUP,), owner.digest(content))
                self.owned[path] = (actual, metadata)
                if path == BINDING:
                    self.preserved[path] = (owner.digest(actual), metadata, (0o440,), (GROUP,))
                else:
                    self.candidate_sha, self.candidate_info = owner.digest(actual), metadata
                self.files.sync(path.parent)
            finally:
                if os.path.lexists(temporary):
                    os.unlink(temporary)

        def replace(self, candidate):
            self.validate_candidate(candidate)
            self.target(BINDING, candidate['binding'])
            self.target(EVIDENCE, candidate['evidence'])

        def validate_installed(self, candidate):
            self.check_owned()
            self.binding = json.loads(candidate['binding'])
            self.validate(candidate['evidence'])

        def restore(self, candidate):
            self.stopped()
            self.check_owned()
            for label, path in (('binding', BINDING), ('evidence', EVIDENCE)):
                content, _ = self.files.read(self.backup_directory / (label + '.original.json'),
                    (0o600,), (0,), owner.digest(self.originals[path][0]))
                if self.owned[path][0] != content:
                    self.target(path, content)

    return EndpointRecovery()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source_manifest_sha256')
    parser.add_argument('--apply', action='store_true')
    request = parser.parse_args()
    os.umask(0o077)
    actions = recovery(request.source_manifest_sha256)
    lock = os.open(HERE / 'gateway-fresh.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
            raise ValueError('owner_lock_metadata')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(run_transition(actions, request.apply)))
    finally:
        os.close(lock)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(json.dumps({'status': 'endpoint-refresh-refused', 'operatorReviewRequired': True}))
        sys.exit(1)
