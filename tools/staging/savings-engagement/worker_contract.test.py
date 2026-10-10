import unittest

from worker_contract import (
    ACCOUNT,
    CA_CREDENTIAL,
    CHECK_SERVICE,
    DATABASE_ROLE,
    DEADLINE_SERVICE,
    DEADLINE_TIMER,
    EXPIRY_EPOCH,
    SERVICE,
    SYSTEM_IDENTIFIER,
    TIMER,
    InstallError,
    database_url,
    provision_sql,
    role_preflight_sql,
    unit_files,
    validate_database_url,
)


class WorkerContractTests(unittest.TestCase):
    def test_dsn_uses_pg_role_and_only_worker_local_public_ca_path(self):
        dsn = database_url("test 'secret")
        self.assertIn(f'postgresql://{DATABASE_ROLE}:', dsn)
        self.assertNotIn(f'{ACCOUNT}:', dsn)
        self.assertIn(f'sslmode=verify-full&sslrootcert={CA_CREDENTIAL}', dsn)
        self.assertEqual(validate_database_url((dsn + '\n').encode()), "test 'secret")
        with self.assertRaises(InstallError):
            validate_database_url(dsn.replace(DATABASE_ROLE, ACCOUNT).encode())

    def test_main_and_readonly_check_units_share_restrictions_and_only_load_url_credential(self):
        units = unit_files()
        main = units[SERVICE].decode()
        check = units[CHECK_SERVICE].decode()
        for directive in (
            'Type=oneshot', 'User=baci-savings-notifications', 'NoNewPrivileges=yes',
            'ProtectSystem=strict', 'ProtectHome=yes', 'TimeoutStartSec=75s',
        ):
            self.assertIn(directive, main)
            self.assertIn(directive, check)
        self.assertIn(f'LoadCredential=db-url:', main)
        self.assertIn(f'LoadCredential=db-url:', check)
        self.assertNotIn('db-ca.pem', main + check)
        self.assertIn('$CREDENTIALS_DIRECTORY/db-url', main)
        self.assertIn('$CREDENTIALS_DIRECTORY/db-url', check)
        self.assertIn('worker.mjs --check', check)
        self.assertNotIn('worker.mjs --check', main)
        self.assertIn(f'-lt {EXPIRY_EPOCH}', main)
        self.assertIn(f'-lt {EXPIRY_EPOCH}', check)
        self.assertNotIn('Unit=baci-savings-notifications-check.service', units[TIMER].decode())
        self.assertNotIn(CHECK_SERVICE, units[DEADLINE_TIMER].decode())
        self.assertIn(f'systemctl stop {TIMER} {SERVICE} {CHECK_SERVICE}', units[DEADLINE_SERVICE].decode())

    def test_role_preflight_is_pinned_and_does_not_reject_public_temp(self):
        sql = role_preflight_sql()
        self.assertIn(SYSTEM_IDENTIFIER, sql)
        self.assertIn('pg_catalog.pg_database', sql)
        self.assertIn('grant_row.grantee = worker_oid', sql)
        self.assertIn("grant_row.privilege_type IN ('CREATE','TEMP')", sql)
        self.assertNotIn('has_database_privilege', sql)
        self.assertIn('BACI_WORKER_ROLE=:role_state', sql)
        self.assertIn('function_row.prosecdef', sql)
        self.assertIn('has_schema_privilege(worker_oid, function_schema.oid', sql)
        self.assertIn('has_function_privilege(worker_oid, function_row.oid', sql)

    def test_provision_sql_contains_only_pinned_role_login_change(self):
        sql = provision_sql("secret'quoted", False)
        self.assertNotIn('current_role', sql)
        self.assertIn('worker_role.rolcanlogin', sql)
        self.assertIn("PASSWORD 'secret''quoted'", sql)
        self.assertIn(f'ALTER ROLE {DATABASE_ROLE}', sql)
        self.assertIn("VALID UNTIL '2026-09-29 15:59:10+00'", sql)
        self.assertIn('BEGIN;', sql)
        self.assertIn('COMMIT;', sql)
        self.assertNotRegex(sql, r'\bGRANT\b')
        self.assertNotIn(ACCOUNT, sql)

    def test_rollback_rehearsal_script_replaces_the_single_commit(self):
        sql = provision_sql('synthetic-rollback-validation-only', False)
        self.assertEqual(sql.count('COMMIT;'), 1)
        rehearsal = sql.replace('COMMIT;', 'ROLLBACK;', 1)
        self.assertEqual(rehearsal.count('COMMIT;'), 0)
        self.assertEqual(rehearsal.count('ROLLBACK;'), 1)
        self.assertIn('synthetic-rollback-validation-only', rehearsal)


if __name__ == '__main__':
    unittest.main()
