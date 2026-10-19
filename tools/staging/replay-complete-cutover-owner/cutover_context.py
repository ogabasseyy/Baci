import base64
import fcntl
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import runpy
import stat
import sys
import uuid

from cutover_runtime import CANDIDATE_ROOT, CANDIDATE_SEAL, COMPETITOR_ID, DOCKER, NATIVE_ID, NATIVE_ROOT, require


FINANCE = Path('/root/baci-financial-owner.2ynkl9kc')
NATIVE_OWNER = Path('/root/baci-replay-native-owner.6b589167c88245c0987823390cba7aed')
PREPARATION = Path('/root/baci-complete-replay-owner.ej9w9hde')
PARENT_SHA = '149db252bdaec8a3d512246e7d7ceb43f80b29a8b70cb4ccfd2d38b3b3a0dd41'
OWNER_SHA = '478c34f626011c1d3595974102626d3d0f2b4056e5cb3caee488dbb5c9bde2ea'
OWNER_RELEASE = '768ce2a340aa9f50802c453f3c85f92020e5df835795df0caecf0be888137df7'
REST_SHA = '09d635769e8f79ec5f2051fe58584e35bf086cfad579741ef4cccf44b366e149'
HELPER_SHA = 'aecb80a7c1bef9f9a974c959378186ef5ab84be6a2127fac6073e0204682bd49'
NONCLAIMANTS = {
    '9b8b56ee647ea8313f62495ce743990b40b91abe0f8a4d2f591d209ff5323518': '/pvb-staging-intake',
    '68113c10e7239a138e859d64e38fb542d397809e75dc0e9a550465b4c7908f63': '/pvb-staging-receipts-rest',
    'beb3dda62db59f84436f2621b8ef4110c09d877e6c72dfc70e4fc72b8088b5f8': '/pvb-staging-receipts-db',
}


def load(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def verify_token(token, secret):
    parts = token.split('.')
    require(len(parts) == 3, 'receipt_token_refused')
    decode = lambda value: base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    header, claims = json.loads(decode(parts[0])), json.loads(decode(parts[1]))
    require(header == {'alg': 'HS256', 'typ': 'JWT'}
            and hmac.compare_digest(decode(parts[2]), hmac.digest(secret, '.'.join(parts[:2]).encode(), 'sha256')),
            'receipt_token_refused')
    return dict(tokenSha256=hashlib.sha256(token.encode()).hexdigest(), signatureVerified=True, claims=claims)


def verify_financial_closure(run):
    script = "import runpy,json;context=runpy.run_path('/root/baci-financial-owner.2ynkl9kc/public-parent-3.py'," \
        "run_name='readonly_task');context['closure']();print(json.dumps({'status':'sealed-financial-source-verified'}))"
    observed = json.loads(run(['/usr/bin/python3', '-B', '-c', script]))
    require(observed == {'status': 'sealed-financial-source-verified'}, 'financial_closure_refused')


def verify_container_set(containers, allowed_claimant=None, check_id=None):
    witnessed = set()
    for value in containers:
        networks = value['NetworkSettings']['Networks']
        if 'pvb-staging-receipts' not in networks:
            continue
        identifier = value['Id']
        if identifier in NONCLAIMANTS:
            require(value['Name'] == NONCLAIMANTS[identifier] and value['State']['Running'],
                    'receipt_infrastructure_identity_refused')
            witnessed.add(identifier)
        elif value['State']['Running']:
            require(identifier in (allowed_claimant, check_id)
                    and value['HostConfig']['RestartPolicy']['Name'] == 'no',
                    'additional_receipt_claimant_refused')
    require(witnessed == set(NONCLAIMANTS), 'receipt_infrastructure_missing')
    return True


class Context:
    def __init__(self, *, external_lock_guard=None):
        require(not sys.flags.optimize, 'optimized_owner_execution_refused')
        require(os.geteuid() == 0, 'root_owner_required')
        self.external_lock_guard = external_lock_guard
        self.verify_external_lock()
        os.umask(0o077)
        sys.dont_write_bytecode = True
        require(hashlib.sha256((FINANCE / 'public-parent-3.py').read_bytes()).hexdigest() == PARENT_SHA,
                'financial_parent_pin_refused')
        self.finance = runpy.run_path(str(FINANCE / 'public-parent-3.py'), run_name='readonly_task')
        verify_financial_closure(self.finance['command'])
        require(hashlib.sha256((NATIVE_OWNER / 'owner/owner.py').read_bytes()).hexdigest() == OWNER_SHA,
                'native_owner_pin_refused')
        sys.path.insert(0, str(NATIVE_OWNER / 'owner'))
        self.owner = load('cutover_verified_owner', NATIVE_OWNER / 'owner/owner.py')
        self.owner.verify_release(NATIVE_OWNER, OWNER_RELEASE)
        inventory = self.owner.read(PREPARATION / 'owner/SOURCE-INVENTORY.sha256', HELPER_SHA)
        for line in inventory.decode().splitlines():
            pin, name = line.split('  ')
            require(Path(name).name == name and name not in ('.', '..'), 'helper_path_refused')
            self.owner.read(PREPARATION / 'owner' / name, pin)
        self.prestart = load('cutover_verified_prestart', PREPARATION / 'owner/prestart.py')
        self.contract = self.prestart.contract
        self.seal = self.owner.decode(self.owner.read(Path(CANDIDATE_ROOT) / 'generation.json', CANDIDATE_SEAL))
        self.verify_files()
        from owner_runtime import DockerRuntime
        self.operator = DockerRuntime(self.owner.command, self.deadline)
        self.deadline()
        self.acquire_launch_lock()

    def verify_external_lock(self):
        if self.external_lock_guard is not None:
            require(callable(self.external_lock_guard) and self.external_lock_guard() is True,
                    'external_launch_lock_required')

    def acquire_launch_lock(self):
        self.verify_external_lock()
        if self.external_lock_guard is not None:
            return
        self.lock = os.open('/root/baci-complete-replay-cutover.lock',
                            os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        info = os.fstat(self.lock)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                and stat.S_IMODE(info.st_mode) == 0o600, 'owner_lock_metadata_refused')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def deadline(self):
        self.verify_external_lock()
        self.owner.verify_deadline(self.owner.command, require_active=True)

    def verify_files(self):
        self.verify_external_lock()
        self.owner.verify_tree(Path(CANDIDATE_ROOT), self.seal['files'])
        self.owner.verify_tree(Path(NATIVE_ROOT), self.contract.PREDECESSOR_FILES)
        require(self.contract.digest(self.seal) == CANDIDATE_SEAL, 'candidate_seal_refused')
        self.prestart._seal(self.seal, CANDIDATE_SEAL)
        return True

    def competitor(self):
        values = json.loads(self.owner.command([*DOCKER, 'inspect', COMPETITOR_ID]))
        require(len(values) == 1, 'competitor_identity_refused')
        return values[0]

    def exclusive(self, allowed_claimant=None):
        self.verify_external_lock()
        identifiers = self.owner.command([*DOCKER, 'container', 'ls', '--all', '--no-trunc',
                                          '--format={{.ID}}']).splitlines()
        values = json.loads(self.finance['command']([*DOCKER, 'inspect', *identifiers]))
        verify_container_set(values, allowed_claimant)
        states = self.owner.command(['/usr/bin/systemctl', 'show', 'baci-interest-replay.service',
                                    '-p', 'ActiveState', '-p', 'SubState', '-p', 'DropInPaths',
                                    '-p', 'NeedDaemonReload'])
        require('ActiveState=inactive\n' in states and 'SubState=dead\n' in states
                and 'DropInPaths=\n' in states and 'NeedDaemonReload=no\n' in states,
                'interest_launcher_must_stay_stopped')
        return True

    def database(self, sql):
        return json.loads(self.finance['database'](sql, container='pvb-staging-receipts-db',
                                                 psql='/usr/local/bin/psql', user='supabase_admin'))

    def execute(self, sql):
        result = self.finance['command']([*DOCKER, 'exec', '-i', 'pvb-staging-receipts-db',
            '/usr/local/bin/psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
            '-U', 'supabase_admin', '-d', 'postgres'], input_text=sql)
        return result.strip().splitlines()[-1]

    def credentials(self):
        settings = {}
        raw = self.owner.read('/home/bassey/pvb-staging-receipts/postgrest.conf', REST_SHA,
                              modes=(0o444,), uid=1001)
        for line in raw.decode().splitlines():
            if '=' in line:
                name, value = line.split('=', 1)
                require(name.strip() not in settings, 'duplicate_rest_setting')
                settings[name.strip()] = value.strip()
        require(json.loads(settings['jwt-aud']) == 'pvb-staging-receipts'
                and settings.get('jwt-role-claim-key', '.role') in ('.role', '".role"'), 'rest_claim_scope_refused')
        secret = json.loads(settings['jwt-secret'])
        secret = base64.b64decode(secret, validate=True) if json.loads(
            settings.get('jwt-secret-is-base64', 'false')) else secret.encode()
        profiles = {'oldNative': (Path(NATIVE_ROOT) / 'config/config.json',
                                 self.contract.PREDECESSOR_FILES['config/config.json']),
                    'oldInterest': (Path('/opt/baci-interest-replay/config.json'), self.contract.INTEREST_CONFIG_SHA256),
                    'new': (Path(CANDIDATE_ROOT) / 'config/config.json', self.seal['files']['config/config.json'])}
        tokens, proofs = {}, {}
        for name, (path, pin) in profiles.items():
            tokens[name] = self.owner.decode(self.owner.read(path, pin, modes=(0o440, 0o600)))['receiptToken']
            proofs[name] = verify_token(tokens[name], secret)
        require(proofs['new']['tokenSha256'] == self.seal['receiptTokenSha256'], 'candidate_token_drift')
        return tokens, proofs

    def journal(self, directory, phase, value):
        self.owner.write(Path(directory) / (phase + '-' + uuid.uuid4().hex + '.json'),
                         self.contract.serialize(value))
