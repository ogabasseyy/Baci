import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import time
from replay_cutover_runtime import (
    CONTAINER, HOST_BINDING, IMAGE, NETWORKS, create_arguments, runtime_files, serialized, validate_container,
)
from runtime_owner_support import DOCKER, command, database, probe
from treasury_owner_contract import ENVIRONMENT, SYSTEM, Refused
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


ACTIVATION_DIGEST = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
LEGACY_ID = 'dd59b310d47c2f0c7524ae144c561b5df6e84b05e99cce17d4858c7d1023215d'
DIRECTORY = Path('/opt/baci-prefunded-replay')
PREPARED = Path('/etc/baci/prefunded-card')
FILES = ('replay-cutover-owner.py', 'replay_cutover_runtime.py', 'replay_cutover_installation.py',
         'replay_cutover_sql.py', 'runtime_owner_support.py', 'treasury_owner_contract.py', 'treasury_owner_io.py',
         'evidence-legacy.sql', 'enrollment-owner-candidate.sql', 'replay-daemon.mjs', 'prefunded-replay-bundle.mjs')
STOPPER = '''[Unit]
Description=Stop bounded prefunded staging receipt replay
[Service]
Type=oneshot
ExecStart=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 15 pvb-staging-replay-prefunded
TimeoutStartSec=30
'''
TIMER = '''[Unit]
Description=Fixed prefunded staging receipt replay deadline
[Timer]
OnCalendar=2026-09-29 15:59:10 UTC
AccuracySec=1s
Persistent=true
Unit=baci-prefunded-replay-deadline.service
'''
HEARTBEAT_READ = '''try {
const fs = require('node:fs');
const value = fs.readFileSync('/tmp/replay-heartbeat', 'utf8');
if (/^[0-9]{13}$/.test(value)) process.stdout.write(value);
} catch {}'''


def place_file(path, content, mode, group):
    if path.exists() or path.is_symlink():
        if read_file(path, os.geteuid(), mode, 16_000_000) != content or path.lstat().st_gid != group:
            raise Refused('Existing replay artifact retained; bytes or group differ')
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fchown(handle.fileno(), os.geteuid(), group)
        os.fchmod(handle.fileno(), mode)
        os.fsync(handle.fileno())


def inspect(name):
    result = json.loads(command([*DOCKER, 'inspect', name]))
    if not isinstance(result, list) or len(result) != 1:
        raise Refused('Replay container identity unavailable')
    return result[0]


def directory(path):
    root_ancestors(path)
    if not path.exists():
        path.mkdir(mode=0o750)
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                raise Refused('New replay directory metadata differs')
            os.fchown(descriptor, 0, 65532)
            os.fchmod(descriptor, 0o750)
        finally:
            os.close(descriptor)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 65532 or stat.S_IMODE(info.st_mode) != 0o750:
        raise Refused('Replay directory metadata differs')


class Installer:
    def __init__(self, bundle):
        self.bundle = bundle
        root_ancestors(bundle)
        private_directory(bundle)
        manifest_bytes = read_file(bundle / 'manifest.json', 0, 0o600, 16384)
        manifest = json.loads(manifest_bytes)
        if set(manifest) != set(FILES):
            raise Refused('Replay owner manifest differs')
        self.contents = {name: read_file(bundle / name, 0, 0o600, 16_000_000) for name in FILES}
        if any(hashlib.sha256(content).hexdigest() != manifest[name] for name, content in self.contents.items()):
            raise Refused('Replay owner checksum differs')
        self.digest = hashlib.sha256(manifest_bytes).hexdigest()
        self.factory_digest = manifest['prefunded-replay-bundle.mjs']

    def preflight(self):
        root_ancestors(PREPARED)
        private_directory(PREPARED)
        activation = read_file(PREPARED / 'activation.prepared.json', 0, 0o600, 131072)
        base = read_file(PREPARED / 'replay-base.prepared.json', 0, 0o600, 32768)
        self.configuration = runtime_files(activation, base, ACTIVATION_DIGEST, self.factory_digest)
        old = inspect('pvb-staging-replay')
        if (old['Id'] != LEGACY_ID or old['Image'] != IMAGE or old['Config']['User'] != '65532:65532'
                or old['Config']['Cmd'] != ['node', '/app/replay.mjs']):
            raise Refused('Original replay container changed')
        db = inspect('baci-isolated-savings-db-1')
        if db['NetworkSettings']['Networks']['baci-isolated-savings_database']['IPAddress'] != HOST_BINDING.split(':')[1]:
            raise Refused('Approved TLS destination changed')
        if probe("SELECT json_build_object('system',system_identifier::text) FROM pg_control_system();") != {'system': SYSTEM}:
            raise Refused('Application database identity differs')
        receipt = database('BEGIN READ ONLY; SELECT system_identifier::text FROM pg_control_system(); ROLLBACK;',
                           container='pvb-staging-receipts-db', psql='psql', user='supabase_admin').strip()
        if receipt != '7686901100561231906':
            raise Refused('Receipt database identity differs')

    def prepare(self):
        directory(DIRECTORY)
        for name in ('code', 'config'):
            directory(DIRECTORY / name)
        for name in ('replay-daemon.mjs', 'prefunded-replay-bundle.mjs'):
            place_file(DIRECTORY / 'code' / name, self.contents[name], 0o644, 65532)
        for name, content in self.configuration.items():
            place_file(DIRECTORY / 'config' / name, content, 0o440, 65532)
        self.container(True)
        self.container(False)

    def container(self, check):
        name = CONTAINER + ('-check' if check else '')
        exists = command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
        if not exists:
            command([*DOCKER, *create_arguments(str(DIRECTORY), self.digest, check)])
            for network in NETWORKS[1:]:
                command([*DOCKER, 'network', 'connect', network, name])
        observed = inspect(name)
        validate_container(observed, str(DIRECTORY), self.digest, check)
        image = json.loads(command([*DOCKER, 'image', 'inspect', IMAGE]))[0]
        if observed['Config'].get('Env') != image['Config'].get('Env'):
            raise Refused('Replay image environment differs')
        if not check and observed['State']['Running']:
            raise Refused('Existing replay is active; do not rerun owner cutover')

    def readiness(self):
        def unique_fields(pairs):
            result = dict(pairs)
            if len(result) != len(pairs):
                raise ValueError()
            return result

        output = {'stdout': bytearray(), 'stderr': bytearray()}
        size = 0
        try:
            with subprocess.Popen([*DOCKER, 'start', '--attach', CONTAINER + '-check'],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env=ENVIRONMENT) as process:
                expires = time.monotonic() + 45
                try:
                    with selectors.DefaultSelector() as selector:
                        selector.register(process.stdout, selectors.EVENT_READ, 'stdout')
                        selector.register(process.stderr, selectors.EVENT_READ, 'stderr')
                        while selector.get_map():
                            remaining = expires - time.monotonic()
                            if remaining <= 0:
                                raise TimeoutError()
                            events = selector.select(remaining)
                            if not events:
                                raise TimeoutError()
                            for key, _mask in events:
                                chunk = os.read(key.fileobj.fileno(), min(4096, 8193 - size))
                                if not chunk:
                                    selector.unregister(key.fileobj)
                                    continue
                                size += len(chunk)
                                if size > 8192:
                                    raise ValueError()
                                output[key.data].extend(chunk)
                        code = process.wait(timeout=max(0, expires - time.monotonic()))
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.wait()
            if code == 0 and not output['stderr']:
                report = json.loads(output['stdout'], object_pairs_hook=unique_fields)
                if (report == {'status': 'replay-runtime-ready', 'readOnly': True}
                        and report['readOnly'] is True):
                    return
            if code == 1 and not output['stdout']:
                report = json.loads(output['stderr'], object_pairs_hook=unique_fields)
                if (isinstance(report, dict) and set(report) == {'status', 'readOnly', 'stage'}
                        and report['status'] == 'replay-runtime-not-ready' and report['readOnly'] is True
                        and report['stage'] in ('configuration', 'prefunded-runtime', 'receipt-database',
                                                'app-database', 'readiness')):
                    raise Refused('Restricted replay readiness refused: stage=' + report['stage'])
        except (OSError, ValueError, TypeError, RecursionError, subprocess.SubprocessError):
            raise Refused('Restricted replay readiness did not pass') from None
        raise Refused('Restricted replay readiness did not pass')

    def sql(self, rehearsal):
        from replay_cutover_sql import render_cutover
        return render_cutover(self.contents['enrollment-owner-candidate.sql'].decode(),
                              self.contents['evidence-legacy.sql'].decode(), rehearsal=rehearsal)

    def rehearse(self):
        database(self.sql(True))

    def deadline(self):
        root_ancestors(Path('/etc/systemd/system/baci-prefunded-replay-deadline.timer'))
        for suffix, content in [('service', STOPPER), ('timer', TIMER)]:
            place_file(Path('/etc/systemd/system/baci-prefunded-replay-deadline.' + suffix), content.encode(), 0o644, 0)
        command(['/usr/bin/systemctl', 'daemon-reload'])
        command(['/usr/bin/systemctl', 'start', 'baci-prefunded-replay-deadline.timer'])
        if command(['/usr/bin/systemctl', 'is-active', 'baci-prefunded-replay-deadline.timer']).strip() != 'active':
            raise Refused('Replay fixed deadline timer not active')

    def stop_old(self):
        if inspect('pvb-staging-replay')['Id'] != LEGACY_ID:
            raise Refused('Original replay changed before stop')
        command([*DOCKER, 'stop', '--time', '15', 'pvb-staging-replay'])
        if inspect('pvb-staging-replay')['State']['Running']:
            raise Refused('Original replay remains active')

    def enroll(self):
        database(self.sql(False))

    def record_commit(self):
        place_file(self.bundle / 'enrollment-commit.json',
                   serialized(dict(status='enrolled', manifestSha256=self.digest)), 0o600, 0)

    def start(self):
        validate_container(inspect(CONTAINER), str(DIRECTORY), self.digest)
        self.started_at_ms = int(time.time() * 1000)
        command([*DOCKER, 'start', CONTAINER])

    def verify(self):
        expires = time.monotonic() + 45
        if inspect('pvb-staging-replay')['State']['Running']:
            raise Refused('Replay worker handover not confirmed')
        while True:
            remaining = expires - time.monotonic()
            if remaining <= 0:
                raise Refused('Replay completed-pass heartbeat not confirmed')
            heartbeat = command([*DOCKER, 'exec', '--user=65532:65532', CONTAINER,
                                 'node', '-e', HEARTBEAT_READ], timeout=min(5, remaining))
            if (re.fullmatch('[0-9]{13}', heartbeat)
                    and self.started_at_ms <= int(heartbeat) <= int(time.time() * 1000)):
                break
            time.sleep(min(1, remaining))
        observed = inspect(CONTAINER)
        validate_container(observed, str(DIRECTORY), self.digest)
        if not observed['State']['Running'] or inspect('pvb-staging-replay')['State']['Running']:
            raise Refused('Replay worker handover not confirmed')
        if command(['/usr/bin/systemctl', 'is-active', 'baci-prefunded-replay-deadline.timer']).strip() != 'active':
            raise Refused('Replay fixed deadline timer not active')
        write_private(self.bundle / 'replay-cutover-result.json', serialized(dict(
            status='signed-replay-enrolled', manifestSha256=self.digest, containerId=observed['Id'],
            cardPaymentsEnabled=False, prefundedReplayEnabled=True)))
