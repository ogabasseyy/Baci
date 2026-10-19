from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import subprocess
import sys
from treasury_owner_contract import (
    BUSINESS, CONTAINER, DEADLINE, DEADLINE_EPOCH, ENVIRONMENT, HOST, INTEGRATION,
    MERCHANT, PSQL, SOURCE, SYSTEM, TREASURY, Refused, owner_input, render_candidate, validate_wallet,
)
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


CONFIG_DIRECTORY = Path('/etc/baci/prefunded-card')
CONFIG = CONFIG_DIRECTORY / 'treasury-snapshot.json'
CA = Path('/etc/baci/piggyvest-staging/postgres-ca.pem')
PROVIDER = Path('/home/bassey/pvb-staging-receipts/intake-config.json')
FILES = ('treasury-owner.py', 'treasury_owner_contract.py', 'treasury_owner_io.py',
         'treasury-owner-candidate.sql', 'treasury-snapshot-store.sql', 'treasury-snapshot-cli.cjs')


def snapshot_config(api_secret, ca, password):
    return {
        'scope': dict(integrationId=INTEGRATION, merchantId=MERCHANT),
        'verifier': dict(environment='staging', systemIdentifier=SYSTEM, expiresAt=DEADLINE,
                         treasuryBindingId=TREASURY, expectedBusinessId=BUSINESS, sourceWalletId=SOURCE,
                         piggyvest=dict(apiBaseUrl='https://staging.piggyvest.business', apiSecret=api_secret,
                                        expectedBusinessId=BUSINESS, expectedCurrency='NGN')),
        'database': dict(environment='staging', transport='tls', host=HOST, expectedHost=HOST, port=5432,
                         login='prefunded_snapshot_verifier', expectedLogin='prefunded_snapshot_verifier',
                         database='postgres', expectedDatabase='postgres', expectedSystemId=SYSTEM,
                         certificateAuthority=ca, password=password),
    }


def function_bodies(source):
    matches = re.findall(r'CREATE FUNCTION prefunded_card\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;', source)
    return dict(matches)


def validate_resume(state, source):
    expected = function_bodies(source)
    if (len(expected) != 4 or state.get('bindingMatches') is not True or state.get('verifierMatches') is not True
            or state.get('customerRoutes') != 0 or state.get('activeCardLogins') != 0):
        raise Refused('Existing treasury scope differs; retained without changes')
    functions = state.get('functions')
    if (not isinstance(functions, list) or len(functions) != len(expected)
            or {function.get('name') for function in functions} != set(expected)):
        raise Refused('Existing treasury function catalog differs')
    for function in functions:
        if (function.get('name') not in expected or function.get('body') != expected[function['name']]
                or function.get('securityDefiner') is not True or function.get('searchPath') != ['search_path=pg_catalog']):
            raise Refused('Existing treasury function catalog differs')


def command(arguments, input_text=None, timeout=30):
    result = subprocess.run(arguments, input=input_text, stdin=None if input_text is not None else subprocess.DEVNULL,
                            text=True, capture_output=True, timeout=timeout, env=ENVIRONMENT)
    if result.returncode != 0:
        state = re.search(r'^ERROR:\s+([A-Z0-9]{5})\s*$', result.stderr, re.MULTILINE)
        if state:
            raise Refused('Reviewed database command failed: SQLSTATE ' + state[1])
        try:
            safe_reason = json.loads(result.stdout).get('reason')
        except (ValueError, AttributeError):
            safe_reason = None
        if safe_reason in ('invalid_configuration', 'expired', 'provider_unavailable',
                           'provider_identity_mismatch', 'treasury_binding_unverified',
                           'invalid_balance', 'stale_clock', 'snapshot_store_unavailable'):
            raise Refused('Treasury snapshot refused: ' + safe_reason)
        raise Refused('Reviewed command did not succeed')
    if len(result.stdout) > 131072:
        raise Refused('Reviewed command did not succeed')
    return result.stdout


def database(sql):
    return command(['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'exec', '-i', CONTAINER,
                    PSQL, '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres'], sql)


def probe(sql):
    prefix = f"""BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
      DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}'
        THEN RAISE EXCEPTION 'wrong database'; END IF; END $$;
    """
    return json.loads(database(prefix + sql + '\nROLLBACK;'))


def read_provider():
    owner = pwd.getpwnam('bassey').pw_uid
    private_directory(PROVIDER.parent, owner)
    config = json.loads(read_file(PROVIDER, owner, 0o444, 16384))
    secret = config.get('providerSecret')
    if config.get('environment') != 'staging' or not isinstance(secret, str) or not re.fullmatch(r'test_key_[A-Za-z0-9]+', secret):
        raise Refused('Staging provider configuration refused')
    return secret


def provider_wallet(secret):
    connection = http.client.HTTPSConnection('staging.piggyvest.business', timeout=10)
    try:
        connection.request('GET', '/api/v1/wallet/' + SOURCE, headers={'Authorization': 'Bearer ' + secret})
        response = connection.getresponse()
        raw = response.read(65537)
        if response.status != 200 or len(raw) > 65536:
            raise Refused('Treasury provider lookup failed')
        validate_wallet(json.loads(raw)['data'])
    finally:
        connection.close()


def resume_state():
    return probe(f"""
      SELECT json_build_object('bindingMatches',
        (SELECT count(*)=1 AND bool_and(binding.id='{TREASURY}' AND binding.integration_id='{INTEGRATION}'
          AND binding.merchant_id='{MERCHANT}' AND binding.expected_business_id='{BUSINESS}'
          AND binding.source_wallet_id='{SOURCE}' AND binding.currency='NGN' AND binding.enabled
          AND binding.authorized_login='prefunded_treasury_operator' AND binding.verified_available_kobo=10000
          AND binding.reserved_kobo=0 AND binding.consumed_kobo=0 AND identity.opening_available_kobo=10000
          AND identity.integration_id=binding.integration_id AND identity.merchant_id=binding.merchant_id
          AND identity.expected_business_id=binding.expected_business_id AND identity.source_wallet_id=binding.source_wallet_id
          AND identity.authorized_login=binding.authorized_login)
        FROM prefunded_card.treasury_bindings binding JOIN prefunded_card.treasury_identities identity
          ON identity.treasury_binding_id=binding.id),
        'verifierMatches',(SELECT count(*)=1 AND bool_and(login_name='prefunded_snapshot_verifier'
          AND treasury_binding_id='{TREASURY}' AND system_identifier='{SYSTEM}' AND expires_at='{DEADLINE}'::timestamptz)
          FROM prefunded_card.treasury_verifier_bindings),
        'customerRoutes',(SELECT count(*) FROM prefunded_card.credit_routes),
        'activeCardLogins',(SELECT count(*) FROM pg_roles WHERE rolname IN
          ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence') AND rolcanlogin),
        'functions',(SELECT json_agg(json_build_object('name',proname,'body',prosrc,
          'securityDefiner',prosecdef,'searchPath',proconfig)) FROM pg_proc
          WHERE pronamespace='prefunded_card'::regnamespace AND proname IN
          ('assert_snapshot_verifier_binding','verify_snapshot_binding','snapshot_database_time','record_scoped_treasury_snapshot')));
    """)


def main():
    stage = 'bundle'
    prepared = False
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1 or datetime.now(timezone.utc).timestamp() >= DEADLINE_EPOCH:
            raise Refused('Root execution within fixed approval required')
        bundle = Path(__file__).absolute().parent
        root_ancestors(bundle)
        private_directory(bundle)
        expected = json.loads(read_file(bundle / 'manifest.json', 0, 0o600, 8192))
        if set(expected) != set(FILES):
            raise Refused('Bundle manifest differs')
        contents = {name: read_file(bundle / name, 0, 0o600, 12_000_000) for name in FILES}
        if any(hashlib.sha256(content).hexdigest() != expected[name] for name, content in contents.items()):
            raise Refused('Bundle checksum differs')
        stage = 'private-inputs'
        root_ancestors(CA)
        ca = read_file(CA, 0, 0o444, 32768).decode()
        if not ca.startswith('-----BEGIN CERTIFICATE-----'):
            raise Refused('Approved database CA unavailable')
        secret = read_provider()
        root_ancestors(CONFIG_DIRECTORY)
        if not CONFIG_DIRECTORY.exists():
            CONFIG_DIRECTORY.mkdir(mode=0o700)
        private_directory(CONFIG_DIRECTORY)
        root_ancestors(CONFIG)
        if CONFIG.exists() or CONFIG.is_symlink():
            config = json.loads(read_file(CONFIG, 0, 0o600, 131072))
            password = config.get('database', {}).get('password', '')
            if config != snapshot_config(secret, ca, password) or not re.fullmatch(r'[A-Za-z0-9_-]{64}', password):
                raise Refused('Existing private configuration differs')
        else:
            password = secrets.token_urlsafe(48)
            config = snapshot_config(secret, ca, password)
            write_private(CONFIG, json.dumps(config, sort_keys=True).encode())
        stage = 'read-only-database-preflight'
        state = probe("""SELECT json_build_object('treasuries',(SELECT count(*) FROM prefunded_card.treasury_bindings),
          'snapshotTable',to_regclass('prefunded_card.treasury_verifier_bindings') IS NOT NULL,
          'snapshotRole',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_snapshot_verifier'));""")
        snapshot = contents['treasury-snapshot-store.sql'].decode()
        stage = 'provider-treasury-read'
        provider_wallet(secret)
        if state == dict(treasuries=0, snapshotTable=False, snapshotRole=False):
            value = owner_input(password)
            sql = render_candidate(contents['treasury-owner-candidate.sql'].decode(), snapshot, value)
            stage = 'database-apply-unconfirmed'
            prepared = None
            database(sql)
        elif state != dict(treasuries=1, snapshotTable=True, snapshotRole=True):
            raise Refused('Partial or foreign treasury installation retained')
        stage = 'database-postflight'
        validate_resume(resume_state(), snapshot)
        prepared = True
        stage = 'restricted-tls-snapshot-proof'
        output = command(['/usr/bin/node', str(bundle / 'treasury-snapshot-cli.cjs'), str(CONFIG)], timeout=35)
        result = json.loads(output)
        if result.get('outcome') not in ('recorded', 'duplicate'):
            raise Refused('Restricted treasury snapshot proof failed')
        stage = 'audit-receipt'
        result = dict(status='treasury-prerequisites-ready', cardPaymentsEnabled=False, servicesStarted=False,
                      sourceWalletId=SOURCE, approvedBudgetKobo=10000, expiresAt=DEADLINE,
                      restrictedTlsVerified=True, snapshotRecorded=True,
                      configSha256=hashlib.sha256(read_file(CONFIG, 0, 0o600, 131072)).hexdigest())
        receipt = bundle / 'treasury-result.json'
        if not receipt.exists():
            write_private(receipt, json.dumps(result, sort_keys=True).encode())
        print(json.dumps(result))
        print('TREASURY_PREREQUISITES_READY')
        return 0
    except Exception as error:
        print(json.dumps(dict(status='refused', stage=stage, databasePrepared=prepared,
                              cardPaymentsEnabled=False, redacted=True,
                              reason=str(error) if isinstance(error, Refused) else 'Unexpected error')))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
