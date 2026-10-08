import secrets
import subprocess
from typing import Dict

from install_io import InstallRefused


DATABASE = 'postgres'
DATABASE_ROLE = 'baci_staging_test_payments'
SYSTEM_IDENTIFIER = '7685292944002592802'
CONTAINER = 'baci-isolated-savings-db-1'
FIXTURE_MERCHANT = '10000000-0000-4000-8000-000000000001'
FIXTURE_CUSTOMER = '10000000-0000-4000-8000-000000000002'
FIXTURE_USER = 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'


def generate_password() -> str:
    return secrets.token_urlsafe(48)


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _run(sql: str) -> str:
    try:
        result = subprocess.run(
            [
                '/usr/bin/docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres',
                '-d', DATABASE, '-XqAt', '-vON_ERROR_STOP=1',
            ],
            check=False,
            capture_output=True,
            text=True,
            input=sql,
            timeout=30,
            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise InstallRefused('Staging database command failed') from error
    if result.returncode or len(result.stdout) > 4096 or len(result.stderr) > 4096:
        raise InstallRefused('Staging database command failed')
    return result.stdout.strip()


def preflight(config: Dict[str, object]) -> None:
    if config.get('merchantId') != FIXTURE_MERCHANT or config.get('customerIds') != [FIXTURE_CUSTOMER]:
        raise InstallRefused('Approved staging fixture rejected')
    sql = f'''BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
DO $preflight$
BEGIN
  IF current_database() <> '{DATABASE}' OR session_user <> 'postgres' OR current_user <> 'postgres'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '{SYSTEM_IDENTIFIER}'
    OR pg_catalog.to_regprocedure('public.credit_customer_wallet(uuid,uuid,numeric,text,uuid,text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.customers
        WHERE id = '{FIXTURE_CUSTOMER}'::uuid AND merchant_id = '{FIXTURE_MERCHANT}'::uuid
          AND user_id = '{FIXTURE_USER}'::uuid AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'staging test payments preflight rejected';
  END IF;
END;
$preflight$;
COMMIT;
SELECT 'BACI_TEST_PAYMENTS_PREFLIGHT';
'''
    if _run(sql) != 'BACI_TEST_PAYMENTS_PREFLIGHT':
        raise InstallRefused('Staging database preflight was not confirmed')


def has_topups() -> bool:
    sql = f'''BEGIN READ ONLY;
DO $topups$
DECLARE
  v_has_topups boolean := false;
BEGIN
  IF current_database() <> '{DATABASE}'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '{SYSTEM_IDENTIFIER}' THEN
    RAISE EXCEPTION 'staging cluster rejected';
  END IF;
  IF pg_catalog.to_regclass('staging_wallet_payments.pending_topups') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM staging_wallet_payments.pending_topups)' INTO v_has_topups;
  END IF;
  PERFORM pg_catalog.set_config('baci.test_payments_has_topups',
    CASE WHEN v_has_topups THEN 'NONZERO' ELSE 'ZERO' END, true);
END;
$topups$;
SELECT pg_catalog.current_setting('baci.test_payments_has_topups');
COMMIT;
'''
    result = _run(sql)
    if result == 'NONZERO':
        return True
    if result == 'ZERO':
        return False
    raise InstallRefused('Staging top-up recovery state was not confirmed')


def provision(schema: bytes, config: Dict[str, object], password: str) -> None:
    try:
        migration = schema.decode('utf-8')
    except UnicodeDecodeError as error:
        raise InstallRefused('Database bundle is not UTF-8') from error
    if config.get('merchantId') != FIXTURE_MERCHANT or config.get('customerIds') != [FIXTURE_CUSTOMER]:
        raise InstallRefused('Approved staging fixture rejected')
    sql = f'''BEGIN;
SET LOCAL statement_timeout = '10s';
{migration}
ALTER ROLE {DATABASE_ROLE} PASSWORD {_literal(password)};
INSERT INTO staging_wallet_payments.config(singleton, merchant_id, customer_id)
VALUES (true, '{FIXTURE_MERCHANT}'::uuid, '{FIXTURE_CUSTOMER}'::uuid)
ON CONFLICT (singleton) DO NOTHING;
DO $configured$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staging_wallet_payments.config
      WHERE singleton AND merchant_id = '{FIXTURE_MERCHANT}'::uuid AND customer_id = '{FIXTURE_CUSTOMER}'::uuid) THEN
    RAISE EXCEPTION 'staging test payments singleton configuration conflicts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = '{DATABASE_ROLE}'
      AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls)
    OR NOT has_function_privilege('{DATABASE_ROLE}',
      'staging_wallet_payments.begin_top_up(uuid,uuid,bigint,text)', 'EXECUTE')
    OR NOT has_function_privilege('{DATABASE_ROLE}',
      'staging_wallet_payments.assert_identity()', 'EXECUTE')
    OR has_table_privilege('{DATABASE_ROLE}', 'staging_wallet_payments.pending_topups', 'SELECT') THEN
    RAISE EXCEPTION 'staging test payments deployment verification failed';
  END IF;
END;
$configured$;
COMMIT;
SELECT 'BACI_TEST_PAYMENTS_PROVISIONED';
'''
    if _run(sql) != 'BACI_TEST_PAYMENTS_PROVISIONED':
        raise InstallRefused('Staging database provisioning was not confirmed')
