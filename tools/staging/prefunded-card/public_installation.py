import copy
import http.client
from pathlib import Path
import time

from public_artifact import ARCHIVE_LIMIT, MANIFEST_LIMIT, digest, validate_archive
from public_database_contract import verify_database
from public_install_io import capture, matching, place, prepare_tree
from public_projection import ACTIVATION_SHA256, parsed, project_anon, project_checkout, serialized
import public_service_contract as contract
from runtime_owner_support import command
from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, Refused
from treasury_owner_io import root_ancestors


ROOT = Path(contract.ROOT)
ACTIVATION = Path('/etc/baci/prefunded-card/activation.prepared.json')
FUNDING = Path('/etc/baci/piggyvest-staging/funding-service.env')
SYSTEMD = Path('/etc/systemd/system')
PRIVATE_PROOF = dict(status='public-private-ready', customerTlsVerified=True, verifierTlsVerified=True, httpStarted=False)


class PublicInstaller:
    def __init__(self, archive, archive_sha256, manifest, manifest_sha256, clock=time.time):
        self.archive, self.archive_sha256 = Path(archive), archive_sha256
        self.manifest, self.digest = Path(manifest), manifest_sha256
        self.clock = clock
        self.start_attempted = False
        self.private_verified = False

    def unexpired(self):
        if self.clock() >= DEADLINE_EPOCH:
            raise Refused('Public staging deadline expired')

    def inspect(self, name):
        result = parsed(command([*contract.DOCKER, 'inspect', name]))
        if not isinstance(result, list) or len(result) != 1:
            raise Refused('Public container inspection refused')
        return result[0]

    def validate(self, observed, pending=False):
        value = copy.deepcopy(observed)
        if (pending and value.get('State', {}).get('Running') is False
                and set(value['NetworkSettings']['Networks']) == {contract.NETWORKS[0]}):
            value['NetworkSettings']['Networks'][contract.NETWORKS[1]] = {}
        contract.validate_container(value, self.digest, self.image_environment)
        if value.get('State', {}).get('Status') not in ('created', 'exited', 'running'):
            raise Refused('Public container state refused')

    def prepare(self):
        self.unexpired()
        root_ancestors(ROOT)
        archive = capture(self.archive, ARCHIVE_LIMIT)
        manifest = capture(self.manifest, MANIFEST_LIMIT)
        app = validate_archive(archive, manifest, self.archive_sha256, self.digest)
        checkout = project_checkout(capture(ACTIVATION, 131072), self.clock())
        anon = project_anon(capture(FUNDING, 131072, modes=(0o400, 0o440, 0o600, 0o640)),
                            self.inspect('baci-isolated-savings-auth-1'), self.clock())
        image = parsed(command([*contract.DOCKER, 'image', 'inspect', contract.IMAGE]))
        if len(image) != 1 or image[0]['Id'] != contract.IMAGE:
            raise Refused('Pinned public image unavailable')
        self.image_environment = image[0]['Config']['Env']
        for network in contract.NETWORKS:
            observed = parsed(command([*contract.DOCKER, 'network', 'inspect', network]))
            if len(observed) != 1 or observed[0]['Name'] != network:
                raise Refused('Public network identity refused')
            if network == contract.NETWORKS[0] and (
                    observed[0].get('Internal') is not True
                    or observed[0].get('Labels', {}).get('com.docker.compose.project') != 'baci-isolated-savings'
                    or not any(item.get('Name') == 'baci-isolated-savings-db-1'
                        and item.get('IPv4Address', '').split('/')[0] == '172.23.0.2'
                        for item in observed[0].get('Containers', {}).values())):
                raise Refused('Public database network refused')
        verify_database()
        self.files = {'app/' + name: content for name, content in app.items()}
        self.files.update({'config/checkout.json': checkout, 'config/anon.json': anon})
        self.files.update({'units/' + name: content.encode() for name, content in contract.units().items()})
        self.receipt = serialized(dict(version=1, manifestSha256=self.digest, archiveSha256=self.archive_sha256,
            activationSha256=ACTIVATION_SHA256, checkoutSha256=digest(checkout), anonSha256=digest(anon),
            deadline=DEADLINE, approvedBudgetKobo=10000, preservedPrincipalKobo=10000))
        existing = command([*contract.DOCKER, 'ps', '-aq', '--filter', 'name=^/' + contract.NAME + '$']).strip()
        if existing:
            observed = self.inspect(contract.NAME)
            self.validate(observed, pending=True)
            prepare_tree(ROOT, self.files, self.receipt, verify_only=True)
        else:
            prepare_tree(ROOT, self.files, self.receipt)
            self.unexpired()
            command([*contract.DOCKER, *contract.create_arguments(self.digest)])
            observed = self.inspect(contract.NAME)
            self.validate(observed, pending=True)
        if set(observed['NetworkSettings']['Networks']) == {contract.NETWORKS[0]}:
            command([*contract.DOCKER, 'network', 'connect', contract.NETWORKS[1], contract.NAME])
        self.validate(self.inspect(contract.NAME))

    def private_proof(self):
        self.unexpired()
        prepare_tree(ROOT, self.files, self.receipt, verify_only=True)
        arguments = contract.create_arguments(self.digest)
        arguments = [item for item in arguments[1:-3]
                     if not item.startswith(('--name=', '--publish=', '--log-driver=', '--log-opt='))]
        watchdog = ("setTimeout(()=>process.exit(124),25000).unref();"
                    "process.argv=['node','/app/launch-public.cjs','--check'];require('/app/launch-public.cjs')")
        result = parsed(command([*contract.DOCKER, 'run', '--rm', '--log-driver=none', *arguments,
                                 contract.IMAGE, '/usr/local/bin/node', '-e', watchdog], timeout=35))
        if serialized(result) != serialized(PRIVATE_PROOF):
            raise Refused('Private public configuration and TLS proof refused')
        self.unexpired()
        self.private_verified = True

    def install_units(self):
        for name, content in contract.units().items():
            path = SYSTEMD / name
            root_ancestors(path)
            if path.exists() or path.is_symlink():
                matching(path, content.encode(), 0o644, 0)
            state = command(['/usr/bin/systemctl', 'show', name,
                '--property=FragmentPath,DropInPaths,UnitFileState'])
            fields = dict(line.split('=', 1) for line in state.splitlines() if '=' in line)
            if (set(fields) != {'FragmentPath', 'DropInPaths', 'UnitFileState'}
                    or fields['FragmentPath'] not in ('', str(path)) or fields['DropInPaths']
                    or fields['UnitFileState'] not in ('', 'static', 'disabled')):
                raise Refused('Foreign public systemd unit retained')
        for name, content in contract.units().items():
            place(SYSTEMD / name, content.encode(), 0o644, 0)
        command(['/usr/bin/systemd-analyze', 'verify', *(str(SYSTEMD / name) for name in contract.units())])
        command(['/usr/bin/systemctl', 'daemon-reload'])

    def start(self):
        self.unexpired()
        if not self.private_verified:
            raise Refused('Private public proof required before HTTP startup')
        prepare_tree(ROOT, self.files, self.receipt, verify_only=True)
        self.validate(self.inspect(contract.NAME))
        verify_database()
        self.install_units()
        self.unexpired()
        command(['/usr/bin/systemctl', 'start', contract.NAME + '-deadline.timer'])
        if command(['/usr/bin/systemctl', 'show', contract.NAME + '-deadline.timer',
                    '--property=ActiveState', '--value']).strip() != 'active':
            raise Refused('Public fixed deadline timer inactive')
        self.unexpired()
        self.start_attempted = True
        command(['/usr/bin/systemctl', 'start', contract.NAME + '.service'])
        deadline = time.monotonic() + 20
        while True:
            try:
                self.probe_http()
                break
            except (OSError, http.client.HTTPException):
                if time.monotonic() >= deadline:
                    raise Refused('Public local HTTP startup refused') from None
                time.sleep(0.2)
        observed = self.inspect(contract.NAME)
        self.validate(observed)
        if observed['State']['Running'] is not True:
            raise Refused('Public HTTP container is not running')
        verify_database()
        self.unexpired()

    def probe_http(self):
        probes = [(method, path, status) for method, path, status in contract.probe_contract() if method == 'GET']
        for method, path, expected in probes:
            self.unexpired()
            connection = http.client.HTTPConnection('127.0.0.1', 4800, timeout=5)
            try:
                connection.request(method, path, headers=dict(contract.PROBE_HEADERS))
                response = connection.getresponse()
                if response.status != expected or len(response.read(1048577)) > 1048576:
                    raise Refused('Public local unauthenticated HTTP probe refused')
            finally:
                connection.close()

    def withdraw(self):
        if not self.start_attempted:
            return
        self.validate(self.inspect(contract.NAME))
        failed = False
        for arguments in contract.rollback_commands():
            try:
                command(arguments)
            except Exception:
                failed = True
        if failed:
            raise Refused('Public access withdrawal needs owner review')
