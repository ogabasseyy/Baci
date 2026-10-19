import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import stat
import re
import time
from runtime_owner_support import DOCKER, command, database, probe
from runtime_scheduler import IMAGE, NETWORKS, PREFIX, ROOT, STATE, create_arguments, units, validate_container
from treasury_owner_contract import DEADLINE_EPOCH, Refused
from treasury_owner_io import private_directory, read_file, root_ancestors


ACTIVATION_SHA = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
SNAPSHOT_SHA = '26438acf5cef760c82a626ccdf7c62ca6ea1e4a531022b6bce1148529e257284'
PREPARED = Path('/etc/baci/prefunded-card')
HEARTBEAT_READ = "process.stdout.write(require('node:fs').readFileSync('/tmp/replay-heartbeat','utf8'))"
FILES = ('runtime-workers-owner.py', 'runtime_worker_installation.py', 'runtime_scheduler.py',
         'runtime_activation_sql.py', 'runtime_owner_support.py', 'treasury_owner_contract.py', 'treasury_owner_io.py',
         'background.cjs', 'snapshot.cjs', 'readiness.cjs', 'background.sh',
         'customer-capability.sql', 'checkout-capability.sql', 'checkout-promotion.sql')


def checked_configs(background, snapshot):
    if hashlib.sha256(background).hexdigest() != ACTIVATION_SHA or hashlib.sha256(snapshot).hexdigest() != SNAPSHOT_SHA:
        raise Refused('Prepared worker credential checksum differs')
    return background, snapshot


def place(path, content, owner=0, mode=0o644):
    if path.exists() or path.is_symlink():
        if read_file(path, owner, mode, 16_000_000) != content or path.lstat().st_gid != owner:
            raise Refused('Existing worker input retained; metadata or bytes differ')
        return
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fchown(handle.fileno(), owner, owner)
        os.fchmod(handle.fileno(), mode)
        os.fsync(handle.fileno())


def directory(path, owner=0, mode=0o700):
    root_ancestors(path)
    if not path.exists():
        path.mkdir(mode=0o700)
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fchown(descriptor, owner, owner)
            os.fchmod(descriptor, mode)
        finally:
            os.close(descriptor)
    metadata = path.lstat()
    if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner or metadata.st_gid != owner
            or stat.S_IMODE(metadata.st_mode) != mode):
        raise Refused('Worker directory metadata differs')


def validate_report(kind, output):
    try:
        report = json.loads(output)
    except (ValueError, TypeError):
        raise Refused('Worker report is unavailable') from None
    expected = {
        'background': [dict(status='completed')],
        'snapshot': [dict(outcome='recorded'), dict(outcome='duplicate')],
        'readiness': [dict(status='restricted-tls-ready', profiles=['worker', 'authorizer', 'evidence'],
                           readOnly=True, cardPaymentsEnabled=False)],
    }
    if report not in expected.get(kind, []):
        raise Refused('Worker did not prove its expected pass: ' + kind)


def inspect(name):
    value = json.loads(command([*DOCKER, 'inspect', name]))
    if not isinstance(value, list) or len(value) != 1:
        raise Refused('Worker container is unavailable')
    return value[0]


def validate_unit(output, suffix):
    expected = dict(FragmentPath='/etc/systemd/system/' + PREFIX + suffix, DropInPaths='')
    try:
        observed = dict(line.split('=', 1) for line in output.strip().splitlines())
    except ValueError:
        raise Refused('Worker unit metadata unavailable') from None
    if observed != expected:
        raise Refused('Worker effective unit differs or has drop-ins')


def validate_heartbeat(value, now):
    if not re.fullmatch('[0-9]{13}', value) or not 0 <= now * 1000 - int(value) <= 120_000:
        raise Refused('Fresh signed replay completed-pass heartbeat required')


class WorkerInstaller:
    def __init__(self, bundle):
        self.bundle = bundle
        self.timers_started = False
        root_ancestors(bundle)
        private_directory(bundle)
        manifest = read_file(bundle / 'manifest.json', 0, 0o600, 16384)
        expected = json.loads(manifest)
        if set(expected) != set(FILES):
            raise Refused('Worker bundle manifest differs')
        self.contents = {name: read_file(bundle / name, 0, 0o600, 16_000_000) for name in FILES}
        if any(hashlib.sha256(content).hexdigest() != expected[name] for name, content in self.contents.items()):
            raise Refused('Worker bundle checksum differs')
        self.digest = hashlib.sha256(manifest).hexdigest()

    def preflight(self):
        root_ancestors(PREPARED)
        private_directory(PREPARED)
        self.background, self.snapshot = checked_configs(
            read_file(PREPARED / 'activation.prepared.json', 0, 0o600, 131072),
            read_file(PREPARED / 'treasury-snapshot.json', 0, 0o600, 131072))
        replay = inspect('pvb-staging-replay-prefunded')
        if not replay['State']['Running'] or inspect('pvb-staging-replay')['State']['Running']:
            raise Refused('Signed replay handover is not healthy')
        heartbeat = command([*DOCKER, 'exec', '--user=65532:65532', 'pvb-staging-replay-prefunded',
                             'node', '-e', HEARTBEAT_READ], timeout=10)
        validate_heartbeat(heartbeat, time.time())
        db = inspect('baci-isolated-savings-db-1')
        if db['NetworkSettings']['Networks'][NETWORKS[0]]['IPAddress'] != '172.23.0.2':
            raise Refused('Restricted database destination differs')
        for kind in ('snapshot', 'background', 'readiness'):
            existing = command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + PREFIX + kind + '$', '--format', '{{.ID}}']).strip()
            if existing and inspect(PREFIX + kind)['State']['Running']:
                raise Refused('Existing worker is active; review rather than reinstall')
        self.rehearse()

    def sql(self, rehearsal):
        from runtime_activation_sql import render_activation
        return render_activation(*(self.contents[name].decode() for name in
                                   ('customer-capability.sql', 'checkout-capability.sql', 'checkout-promotion.sql')),
                                 rehearsal=rehearsal)

    def rehearse(self):
        database(self.sql(True))

    def prepare(self):
        directory(Path(ROOT), mode=0o755)
        directory(Path(ROOT) / 'code', mode=0o755)
        directory(Path(ROOT) / 'config')
        for name in ('background.cjs', 'snapshot.cjs', 'readiness.cjs', 'background.sh'):
            place(Path(ROOT) / 'code' / name, self.contents[name], mode=0o444)
        place(Path(ROOT) / 'config/background.json', self.background, 65532, 0o600)
        place(Path(ROOT) / 'config/snapshot.json', self.snapshot, 65531, 0o600)
        directory(Path('/var/lib/baci-staging'), mode=0o755)
        directory(Path(STATE), 65532, 0o700)
        lock = Path(STATE) / 'runner.lock'
        if not lock.exists() and not lock.is_symlink():
            place(lock, b'', 65532, 0o600)
        metadata = lock.lstat()
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 65532 or metadata.st_gid != 65532
                or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_nlink != 1 or metadata.st_size != 0):
            raise Refused('Worker lock metadata differs')
        for kind in ('snapshot', 'background', 'readiness'):
            self.container(kind)

    def container(self, kind):
        name = PREFIX + kind
        if not command([*DOCKER, 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip():
            command([*DOCKER, *create_arguments(kind, self.digest)])
            command([*DOCKER, 'network', 'connect', NETWORKS[1], name])
        observed = inspect(name)
        validate_container(observed, kind, self.digest)
        image = json.loads(command([*DOCKER, 'image', 'inspect', IMAGE]))[0]
        if observed['Config']['Env'] != image['Config']['Env']:
            raise Refused('Worker image environment differs')
        if observed['State']['Running']:
            raise Refused('Existing worker is active; not replaced')

    def run_once(self, kind):
        self.container(kind)
        try:
            if kind == 'readiness':
                output = command([*DOCKER, 'start', '--attach', PREFIX + kind], timeout=45)
            else:
                started_at = datetime.now(timezone.utc)
                command(['/usr/bin/systemctl', 'start', PREFIX + kind + '.service'], timeout=500 if kind == 'background' else 60)
                unit = command(['/usr/bin/systemctl', 'show', PREFIX + kind + '.service',
                                '--property=Result', '--property=ExecMainStatus', '--property=ActiveState'])
                if dict(line.split('=', 1) for line in unit.strip().splitlines()) != dict(
                        Result='success', ExecMainStatus='0', ActiveState='inactive'):
                    raise Refused('Exact scheduled unit did not finish successfully')
                stamp = inspect(PREFIX + kind)['State']['StartedAt']
                if datetime.fromisoformat(stamp.replace('Z', '+00:00')) < started_at:
                    raise Refused('Scheduled worker did not complete a fresh invocation')
                output = command([*DOCKER, 'logs', '--since', stamp, PREFIX + kind])
            validate_report(kind, output)
            observed = inspect(PREFIX + kind)
            if observed['State']['Running'] or observed['State']['ExitCode'] != 0:
                raise Refused('Worker pass did not terminate successfully')
        finally:
            command([*DOCKER, 'stop', '--time', '5', PREFIX + kind], timeout=15)

    def install_units(self):
        names = []
        for suffix, content in units().items():
            path = Path('/etc/systemd/system') / (PREFIX + suffix)
            root_ancestors(path)
            place(path, content.encode())
            names.append(str(path))
        command(['/usr/bin/systemd-analyze', 'verify', *names])
        command(['/usr/bin/systemctl', 'daemon-reload'])
        for suffix in units():
            validate_unit(command(['/usr/bin/systemctl', 'show', PREFIX + suffix,
                                   '--property=FragmentPath', '--property=DropInPaths']), suffix)
        command(['/usr/bin/systemctl', 'start', PREFIX + 'deadline.timer'])
        self.timer('deadline')

    def timer(self, kind):
        if command(['/usr/bin/systemctl', 'is-active', PREFIX + kind + '.timer']).strip() != 'active':
            raise Refused('Expected worker timer is not active')

    def apply(self):
        database(self.sql(False))

    def schedule(self):
        if time.time() >= DEADLINE_EPOCH - 60:
            raise Refused('Worker scheduling approval expired')
        self.timers_started = True
        command(['/usr/bin/systemctl', 'start', PREFIX + 'snapshot.timer', PREFIX + 'background.timer'])
        self.timer('snapshot')
        self.timer('background')
        self.timer('deadline')

    def withdraw(self):
        if self.timers_started:
            command(['/usr/bin/systemctl', 'stop', PREFIX + 'snapshot.timer', PREFIX + 'background.timer',
                     PREFIX + 'snapshot.service', PREFIX + 'background.service'], timeout=30)

    def verify_no_payment(self):
        observed = probe("""SELECT json_build_object(
          'operations',(SELECT count(*) FROM prefunded_card.operations),
          'intents',(SELECT count(*) FROM prefunded_card.checkout_intents),
          'principal',(SELECT current_amount FROM public.customer_savings_goals
            WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
          'reserved',(SELECT reserved_kobo FROM prefunded_card.treasury_bindings),
          'consumed',(SELECT consumed_kobo FROM prefunded_card.treasury_bindings));""")
        if observed != dict(operations=0, intents=0, principal=100, reserved=0, consumed=0):
            raise Refused('Initial worker pass changed payment state; review required')
