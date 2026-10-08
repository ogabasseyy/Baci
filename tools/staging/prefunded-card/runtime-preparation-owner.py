from datetime import datetime, timezone
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import sys
from runtime_configuration import build_runtime_configuration
from runtime_owner_support import database, inspect, probe, read_replay_inputs, command, save_exact
from runtime_replay_configuration import prepare_replay_configuration
from treasury_owner_contract import (
    BUSINESS, CONTAINER, DEADLINE, DEADLINE_EPOCH, INTEGRATION, MERCHANT, SOURCE, SYSTEM, TREASURY, Refused,
)
from treasury_owner_io import private_directory, read_file, root_ancestors


DIRECTORY = Path('/etc/baci/prefunded-card')
CA = Path('/etc/baci/piggyvest-staging/postgres-ca.pem')
PAYSTACK = Path('/etc/baci/staging-test-payments/paystack-secret')
INTAKE = Path('/home/bassey/pvb-staging-receipts/intake-config.json')
FILES = (
    'runtime-preparation-owner.py', 'runtime_configuration.py', 'runtime_owner_support.py',
    'runtime_replay_configuration.py', 'runtime-credentials-owner.sql', 'runtime-readiness-cli.cjs',
    'activation-config.template.json', 'treasury_owner_contract.py', 'treasury_owner_io.py',
)
PASSWORD_FIELDS = {'prefunded_treasury_operator': 'treasuryPassword',
                   'prefunded_authorizer': 'authorizerPassword', 'prefunded_evidence': 'evidencePassword'}


def credential_material():
    path = DIRECTORY / 'runtime-credentials.json'
    if path.exists() or path.is_symlink():
        value = json.loads(read_file(path, 0, 0o600, 8192))
    else:
        value = dict(expiresAt=DEADLINE, systemIdentifier=SYSTEM, credentialProof=secrets.token_urlsafe(48),
                     passwords={name: secrets.token_urlsafe(48) for name in PASSWORD_FIELDS})
    if (not isinstance(value, dict) or set(value) != {'expiresAt', 'systemIdentifier', 'credentialProof', 'passwords'}
            or value.get('expiresAt') != DEADLINE or value.get('systemIdentifier') != SYSTEM
            or not isinstance(value.get('credentialProof'), str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{64}', value['credentialProof'])
            or not isinstance(value.get('passwords'), dict) or set(value['passwords']) != set(PASSWORD_FIELDS)
            or any(not isinstance(item, str) or not re.fullmatch(r'[A-Za-z0-9_-]{64}', item)
                   for item in value['passwords'].values()) or len(set(value['passwords'].values())) != 3):
        raise Refused('Private runtime credential state refused')
    save_exact(path, value)
    return value


def render_sql(source, material, login_count):
    if type(login_count) is not int or login_count not in (0, 3) or source.count('__OWNER_INPUT__') != 1:
        raise Refused('Runtime role transition refused')
    value = dict(systemIdentifier=SYSTEM, databaseName='postgres', integrationId=INTEGRATION,
                 merchantId=MERCHANT, treasuryBindingId=TREASURY, businessId=BUSINESS, sourceWalletId=SOURCE,
                 openingAvailableKobo=10000, expiresAt=DEADLINE,
                 mode='initial' if login_count == 0 else 'retry', credentialProof=material['credentialProof'])
    if login_count == 0:
        value.update({field: material['passwords'][role] for role, field in PASSWORD_FIELDS.items()})
    literal = json.dumps(value, sort_keys=True, separators=(',', ':')).replace("'", "''")
    return source.replace('__OWNER_INPUT__', "'" + literal + "'")


def prepared_inputs(contents):
    root_ancestors(CA)
    root_ancestors(PAYSTACK)
    ca = read_file(CA, 0, 0o444, 32768).decode()
    paystack = read_file(PAYSTACK, 0, 0o600, 8192).decode().strip()
    owner = pwd.getpwnam('bassey').pw_uid
    private_directory(INTAKE.parent, owner)
    intake = json.loads(read_file(INTAKE, owner, 0o444, 16384))
    if intake.get('environment') != 'staging':
        raise Refused('Staging intake identity refused')
    treasury = json.loads(read_file(DIRECTORY / 'treasury-snapshot.json', 0, 0o600, 131072))
    if (treasury.get('verifier', {}).get('piggyvest', {}).get('apiSecret') != intake.get('providerSecret')
            or treasury.get('database', {}).get('certificateAuthority') != ca
            or treasury.get('verifier', {}).get('expiresAt') != DEADLINE):
        raise Refused('Approved treasury inputs differ')
    app = inspect(CONTAINER)
    if app.get('Config', {}).get('Labels', {}).get('com.docker.compose.project') != 'baci-isolated-savings':
        raise Refused('Staging project identity refused')
    receipt_id = database('BEGIN READ ONLY; SELECT system_identifier::text FROM pg_control_system(); ROLLBACK;',
                          container='pvb-staging-receipts-db', psql='psql', user='supabase_admin').strip()
    if receipt_id != '7686901100561231906':
        raise Refused('Receipt database identity refused')
    original, signing_keys = read_replay_inputs(owner)
    prepared = prepare_replay_configuration(original, signing_keys, intake.get('encryptionKey'))
    replay_path = DIRECTORY / 'replay-base.prepared.json'
    if replay_path.exists() or replay_path.is_symlink():
        prepared = json.loads(read_file(replay_path, 0, 0o600, 32768))
        prepare_replay_configuration(prepared, signing_keys, intake.get('encryptionKey'))
        for name in ('receiptToken', 'appToken'):
            claims = json.loads(base64.urlsafe_b64decode(prepared[name].split('.')[1] + '==='))
            if claims['exp'] != DEADLINE_EPOCH:
                raise Refused('Prepared replay deadline differs')
    material = credential_material()
    config = build_runtime_configuration(json.loads(contents['activation-config.template.json']), ca,
                                         intake.get('providerSecret'), paystack, material['passwords'])
    return material, config, prepared


def main():
    stage = 'owner-bundle'
    prepared = False
    lock = None
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1 or datetime.now(timezone.utc).timestamp() >= DEADLINE_EPOCH - 180:
            raise Refused('Root execution within fixed staging window required')
        bundle = Path(__file__).absolute().parent
        root_ancestors(bundle)
        private_directory(bundle)
        expected = json.loads(read_file(bundle / 'manifest.json', 0, 0o600, 8192))
        if set(expected) != set(FILES):
            raise Refused('Runtime bundle manifest differs')
        contents = {name: read_file(bundle / name, 0, 0o600, 12_000_000) for name in FILES}
        if any(hashlib.sha256(content).hexdigest() != expected[name] for name, content in contents.items()):
            raise Refused('Runtime bundle checksum differs')
        root_ancestors(DIRECTORY)
        private_directory(DIRECTORY)
        lock = os.open(DIRECTORY / 'runtime-preparation.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
            raise Refused('Runtime preparation lock refused')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        stage = 'approved-private-inputs'
        material, config, replay = prepared_inputs(contents)
        config_path = DIRECTORY / 'activation.prepared.json'
        save_exact(config_path, config)
        stage = 'configuration-preflight'
        checked = json.loads(command(['/usr/bin/node', str(bundle / 'runtime-readiness-cli.cjs'), '--check', str(config_path)]))
        if checked != dict(status='configuration-checked', databaseContacted=False, cardPaymentsEnabled=False):
            raise Refused('Runtime configuration preflight refused')
        stage = 'role-state'
        role_state = probe("""SELECT json_build_object('loginCount',count(*) FILTER(WHERE rolcanlogin),'roleCount',count(*))
          FROM pg_roles WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence');""")
        if role_state.get('roleCount') != 3:
            raise Refused('Expected runtime roles unavailable')
        source = render_sql(contents['runtime-credentials-owner.sql'].decode(), material, role_state.get('loginCount'))
        stage = 'database-apply-unconfirmed'
        prepared = None
        database(source)
        prepared = True
        stage = 'restricted-tls-readiness'
        readiness = json.loads(command(['/usr/bin/node', str(bundle / 'runtime-readiness-cli.cjs'), '--connect', str(config_path)], timeout=25))
        if readiness != dict(status='restricted-tls-ready', profiles=['worker', 'authorizer', 'evidence'],
                             readOnly=True, cardPaymentsEnabled=False):
            raise Refused('Restricted runtime readiness refused')
        stage = 'private-prepared-replay'
        save_exact(DIRECTORY / 'replay-base.prepared.json', replay)
        report = dict(status='restricted-runtime-prepared', restrictedTlsVerified=True,
                      expiresAt=DEADLINE, cardPaymentsEnabled=False, prefundedReplayEnabled=False,
                      liveReplayUpdated=False, servicesStarted=False,
                      configurationSha256=hashlib.sha256(read_file(config_path, 0, 0o600, 131072)).hexdigest())
        save_exact(bundle / 'runtime-result.json', report)
        print(json.dumps(report))
        return 0
    except Exception as error:
        print(json.dumps(dict(status='refused', stage=stage, databasePrepared=prepared,
                              reason=str(error) if isinstance(error, Refused) else 'Runtime preparation refused',
                              cardPaymentsEnabled=False, prefundedReplayEnabled=False, redacted=True)))
        return 1
    finally:
        if lock is not None:
            os.close(lock)


if __name__ == '__main__':
    sys.exit(main())
