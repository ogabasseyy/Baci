import re

from readiness_evidence_io import DEADLINE, DOCKER, command, decode, inspection, require
from treasury_owner_contract import BUSINESS, CONTAINER, HOST, INTEGRATION, MERCHANT, PSQL, SOURCE, SYSTEM, TREASURY

ADDRESS = '172.23.0.2'
NETWORK = 'baci-isolated-savings_database'
DATABASE_KEYS = {'environment', 'transport', 'host', 'expectedHost', 'port', 'login', 'expectedLogin',
                 'database', 'expectedDatabase', 'expectedSystemId', 'certificateAuthority', 'password'}
SESSION_SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout='2s';
SET LOCAL lock_timeout='1s';
SET LOCAL search_path=pg_catalog;
SELECT json_build_object('login',session_user,'database',current_database(),
 'address',host(inet_server_addr()),'readOnly',current_setting('transaction_read_only')='on',
 'tls',(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()),
 'roleSafe',(SELECT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
   AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication
   AND rolvaliduntil='2026-10-06T15:59:10Z'::timestamptz
   FROM pg_roles WHERE rolname=session_user),
 'membershipSafe',(SELECT count(*)=1 AND bool_and(roleid=(SELECT oid FROM pg_roles
   WHERE rolname='prefunded_treasury_verifier') AND NOT admin_option AND NOT inherit_option AND NOT set_option)
   FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user))
   AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='prefunded_treasury_verifier' AND NOT rolcanlogin
     AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
   AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname=session_user)
     OR member=(SELECT oid FROM pg_roles WHERE rolname='prefunded_treasury_verifier'))
   AND NOT has_function_privilege(session_user,
     'prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint)','EXECUTE'));
ROLLBACK;
"""
BINDING_SQL = f"""BEGIN READ ONLY;
SET LOCAL statement_timeout='3s';
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN IF session_user<>'postgres' OR inet_client_addr() IS NOT NULL
 OR (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}' THEN
 RAISE EXCEPTION 'identity refused'; END IF; END $$;
SELECT json_build_object('bindingVerified',EXISTS(
 SELECT 1 FROM prefunded_card.treasury_verifier_bindings verifier
 JOIN prefunded_card.treasury_bindings binding ON binding.id=verifier.treasury_binding_id
 JOIN prefunded_card.treasury_identities identity ON identity.treasury_binding_id=binding.id
 JOIN piggyvest_staging.integrations registry ON registry.id=binding.integration_id
 WHERE verifier.login_name='prefunded_snapshot_verifier'
 AND verifier.treasury_binding_id='{TREASURY}' AND verifier.system_identifier='{SYSTEM}'
 AND verifier.expires_at='{DEADLINE}'::timestamptz AND binding.enabled AND registry.enabled
 AND binding.integration_id='{INTEGRATION}' AND binding.merchant_id='{MERCHANT}'
 AND registry.expected_provider_account_id='{BUSINESS}' AND binding.currency='NGN'
 AND binding.expected_business_id='{BUSINESS}' AND binding.source_wallet_id='{SOURCE}'
 AND identity.integration_id=binding.integration_id AND identity.merchant_id=binding.merchant_id
 AND identity.expected_business_id=binding.expected_business_id
 AND identity.source_wallet_id=binding.source_wallet_id
 AND identity.authorized_login=binding.authorized_login));
ROLLBACK;
"""


def collect(configuration, ca_path, run=command):
    require(isinstance(configuration, dict) and set(configuration) == {'scope', 'verifier', 'database'},
            'snapshot_configuration_refused')
    database = configuration['database']
    require(isinstance(database, dict) and set(database) == DATABASE_KEYS, 'snapshot_database_refused')
    expected = {'environment': 'staging', 'transport': 'tls', 'host': HOST, 'expectedHost': HOST,
        'port': 5432, 'login': 'prefunded_snapshot_verifier', 'expectedLogin': 'prefunded_snapshot_verifier',
        'database': 'postgres', 'expectedDatabase': 'postgres', 'expectedSystemId': SYSTEM}
    require(all(database.get(key) == value for key, value in expected.items()), 'snapshot_identity_refused')
    require(configuration['scope'] == {'integrationId': INTEGRATION, 'merchantId': MERCHANT},
            'snapshot_scope_refused')
    verifier = configuration['verifier']
    require(isinstance(verifier, dict) and all(verifier.get(key) == value for key, value in {
        'environment': 'staging', 'systemIdentifier': SYSTEM, 'treasuryBindingId': TREASURY,
        'expectedBusinessId': BUSINESS, 'sourceWalletId': SOURCE, 'expiresAt': DEADLINE}.items()),
        'snapshot_scope_refused')
    require(isinstance(database['password'], str) and re.fullmatch('[A-Za-z0-9_-]{64}', database['password'])
            and isinstance(database['certificateAuthority'], str)
            and 1 <= len(database['certificateAuthority']) <= 32768, 'snapshot_credentials_refused')
    require(isinstance(ca_path, str) and re.fullmatch(r'/[A-Za-z0-9_./-]+', ca_path)
            and '..' not in ca_path.split('/'), 'snapshot_ca_path_refused')
    observed = inspection(CONTAINER, run)
    require(observed.get('State', {}).get('Running') is True
            and observed.get('Config', {}).get('Labels', {}).get('com.docker.compose.project') == 'baci-isolated-savings'
            and observed.get('NetworkSettings', {}).get('Networks', {}).get(NETWORK, {}).get('IPAddress') == ADDRESS,
            'snapshot_endpoint_refused')
    certificate = run([*DOCKER, 'exec', CONTAINER, '/bin/cat', ca_path])
    require(certificate == database['certificateAuthority'], 'snapshot_ca_mismatch')
    environment = {'PGHOST': HOST, 'PGHOSTADDR': ADDRESS, 'PGPORT': '5432', 'PGUSER': database['login'],
        'PGDATABASE': 'postgres', 'PGPASSWORD': database['password'], 'PGSSLMODE': 'verify-full',
        'PGSSLROOTCERT': ca_path, 'PGCONNECT_TIMEOUT': '3', 'PGAPPNAME': 'baci-snapshot-readonly-readiness'}
    args = [*DOCKER, 'exec', '-i']
    for name in environment:
        args.extend(['--env', name])
    session = decode(run([*args, CONTAINER, PSQL, '-XqAt', '-v', 'ON_ERROR_STOP=1'],
                         input_text=SESSION_SQL, extra_env=environment))
    require(session == {'login': 'prefunded_snapshot_verifier', 'database': 'postgres',
        'address': ADDRESS, 'readOnly': True, 'tls': True, 'roleSafe': True,
        'membershipSafe': True}, 'snapshot_tls_session_refused')
    proof = decode(run([*DOCKER, 'exec', '-i', CONTAINER, PSQL, '-XqAt', '-v', 'ON_ERROR_STOP=1',
        '-U', 'postgres', '-d', 'postgres'], input_text=BINDING_SQL))
    require(proof == {'bindingVerified': True}, 'snapshot_binding_refused')
    return {'snapshotTlsIdentityVerified': True}
