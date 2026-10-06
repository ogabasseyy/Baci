import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).with_name('connectivity-role.sql')
SPEC = importlib.util.spec_from_file_location('connectivity_role', SOURCE.with_name('connectivity_role.py'))
connectivity_role = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(connectivity_role)
ROLE = 'piggyvest_staging_provisioner'
TARGET = '2026-10-06T15:59:10Z'
RESULT = {'role': ROLE, 'bounded': True, 'passwordUnchanged': True, 'expiresAt': TARGET}


class ConnectivityRolePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('pg_config'):
            raise unittest.SkipTest('local PostgreSQL fixture runtime is unavailable')
        cls.binaries = Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
        if not all((cls.binaries / name).is_file() for name in ('initdb', 'pg_ctl', 'psql')):
            raise unittest.SkipTest('local PostgreSQL fixture runtime is incomplete')
        parent = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
        cls.temporary = tempfile.TemporaryDirectory(prefix='baci-connectivity-role-', dir=parent)
        cls.root = Path(cls.temporary.name)
        cls.data = cls.root / 'data'
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir(mode=0o700)
        try:
            subprocess.run([str(cls.binaries / 'initdb'), '-D', str(cls.data), '-U', 'postgres',
                            '-A', 'trust', '-E', 'UTF8', '--no-locale'], capture_output=True, check=True, timeout=30)
            subprocess.run([str(cls.binaries / 'pg_ctl'), '-D', str(cls.data), '-l', str(cls.root / 'postgres.log'),
                            '-o', f"-k {cls.socket} -h '' -p 65491", '-w', 'start'],
                           capture_output=True, check=True, timeout=30)
            cls.system = cls.sql('SELECT system_identifier FROM pg_control_system();').stdout.strip()
        except Exception:
            cls.stop_fixture()
            raise

    @classmethod
    def stop_fixture(cls):
        try:
            if (cls.data / 'postmaster.pid').exists():
                subprocess.run([str(cls.binaries / 'pg_ctl'), '-D', str(cls.data), '-m', 'fast', '-w', 'stop'],
                               capture_output=True, check=True, timeout=30)
        finally:
            cls.temporary.cleanup()

    @classmethod
    def tearDownClass(cls):
        cls.stop_fixture()

    @classmethod
    def sql(cls, statement, check=True, database='postgres'):
        result = subprocess.run([str(cls.binaries / 'psql'), '-h', str(cls.socket), '-p', '65491',
                                 '-U', 'postgres', '-d', database, '-XqAt', '-v', 'ON_ERROR_STOP=1'],
                                input=statement, text=True, capture_output=True, timeout=20)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result

    def setUp(self):
        self.sql('DROP SCHEMA IF EXISTS piggyvest_savings_ledger CASCADE; '
                 'DROP SCHEMA IF EXISTS piggyvest_staging CASCADE; '
                 'DROP SCHEMA IF EXISTS fixture_fences CASCADE; '
                 f'DROP ROLE IF EXISTS {ROLE}; DROP ROLE IF EXISTS fixture_parent; '
                 f"CREATE ROLE {ROLE} LOGIN NOINHERIT PASSWORD 'fixture-secret'; "
                 'CREATE ROLE fixture_parent; CREATE SCHEMA piggyvest_staging; '
                 'CREATE SCHEMA piggyvest_savings_ledger; CREATE SCHEMA fixture_fences; '
                 f'GRANT USAGE ON SCHEMA piggyvest_staging TO {ROLE}; '
                 'CREATE TABLE fixture_fences.money_retirement(principal_kobo bigint, '
                 'approved_kobo bigint, reserved_kobo bigint, consumed_kobo bigint, retired boolean); '
                 'INSERT INTO fixture_fences.money_retirement VALUES (10000,10000,0,0,true);')
        rows = [match.groupdict() for match in re.finditer(
            r"\('(?P<schema>piggyvest_staging)', '(?P<name>[a-z_]+)', '(?P<args>[^']+)', '(?P<digest>[0-9a-f]{64})'\)",
            SOURCE.read_text())]
        self.assertEqual(len(rows), 11)
        self.sql('\n'.join(
            f"CREATE FUNCTION {row['schema']}.{row['name']}({row['args']}) RETURNS boolean "
            'LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$; '
            f"REVOKE ALL ON FUNCTION {row['schema']}.{row['name']}({self.types(row['args'])}) FROM PUBLIC; "
            f"GRANT EXECUTE ON FUNCTION {row['schema']}.{row['name']}({self.types(row['args'])}) TO {ROLE};"
            for row in rows))
        digests = json.loads(self.sql(
            "SELECT jsonb_object_agg(proname,encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')) "
            "FROM pg_proc WHERE pronamespace='piggyvest_staging'::regnamespace;").stdout)
        self.fragment = SOURCE.read_text().replace('7685292944002592802', self.system)
        for row in rows:
            self.fragment = self.fragment.replace(row['digest'], digests[row['name']])

    @staticmethod
    def types(arguments):
        return ', '.join(argument.split(' ', 1)[1] for argument in arguments.split(', '))

    def script(self, commit=True):
        return connectivity_role.render_connectivity_role_script(commit).replace(
            connectivity_role.FRAGMENT.rstrip(), self.fragment.rstrip())

    def state(self, omit_expiry=False):
        value = json.loads(self.sql(f"""
          SELECT jsonb_build_object(
            'role', (SELECT to_jsonb(worker) FROM pg_authid worker WHERE rolname='{ROLE}'),
            'memberships', (SELECT coalesce(jsonb_agg(to_jsonb(member)), '[]'::jsonb) FROM pg_auth_members member),
            'grants', (SELECT jsonb_agg(jsonb_build_array(oid,proacl,proowner,prosrc) ORDER BY oid)
              FROM pg_proc WHERE pronamespace IN ('piggyvest_staging'::regnamespace,'piggyvest_savings_ledger'::regnamespace)),
            'schemas', (SELECT jsonb_agg(jsonb_build_array(oid,nspacl) ORDER BY oid) FROM pg_namespace
              WHERE nspname IN ('piggyvest_staging','piggyvest_savings_ledger')),
            'fences', (SELECT jsonb_agg(to_jsonb(fence)) FROM fixture_fences.money_retirement fence)
          );
        """).stdout)
        if omit_expiry:
            value['role'].pop('rolvaliduntil')
        return value

    def assert_refused(self, message, script=None, database='postgres'):
        before = self.state()
        result = self.sql(script if script is not None else self.script(), check=False, database=database)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)
        self.assertEqual(result.stdout.strip(), '')
        self.assertEqual(self.state(), before)

    def test_fixture_uses_only_a_private_unix_socket(self):
        self.assertEqual(self.sql('SHOW listen_addresses;').stdout.strip(), '')
        self.assertEqual(self.sql('SELECT inet_client_addr() IS NULL;').stdout.strip(), 't')

    def test_catalog_and_advisory_locks_are_held_until_caller_rolls_back(self):
        probe = """
          SELECT jsonb_build_object(
            'catalogsLocked', (SELECT count(*) = 4 FROM pg_locks WHERE pid=pg_backend_pid()
              AND granted AND mode='ShareRowExclusiveLock' AND relation IN (
                'pg_authid'::regclass, 'pg_auth_members'::regclass, 'pg_proc'::regclass, 'pg_namespace'::regclass)),
            'advisoryLocked', EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid()
              AND locktype='advisory' AND granted)
          );
        """
        results = self.sql(self.script(False).replace('ROLLBACK;', probe + 'ROLLBACK;')).stdout.splitlines()
        self.assertEqual(json.loads(results[0]), RESULT)
        self.assertEqual(json.loads(results[1]), {'catalogsLocked': True, 'advisoryLocked': True})

    def test_rollback_leaves_expiry_password_grants_and_fences_untouched(self):
        before = self.state()
        self.assertIsNone(before['role']['rolvaliduntil'])
        result = json.loads(self.sql(self.script(False)).stdout)
        self.assertEqual(result, RESULT)
        self.assertEqual(self.state(), before)

    def test_commit_and_retry_bound_expiry_without_changing_password_grants_or_fences(self):
        before = self.state(omit_expiry=True)
        for attempt in range(2):
            with self.subTest(attempt=attempt):
                self.assertEqual(json.loads(self.sql(self.script()).stdout), RESULT)
                self.assertEqual(self.state(omit_expiry=True), before)
                self.assertEqual(self.sql(f"SELECT rolvaliduntil='{TARGET}'::timestamptz FROM pg_authid "
                                          f"WHERE rolname='{ROLE}';").stdout.strip(), 't')

    def test_extra_public_executable_function_in_either_schema_is_refused(self):
        for schema in ('piggyvest_staging', 'piggyvest_savings_ledger'):
            with self.subTest(schema=schema):
                self.sql(f'CREATE FUNCTION {schema}.unexpected() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;')
                self.assert_refused('executable function set differs')
                self.sql(f'DROP FUNCTION {schema}.unexpected();')

    def test_memberships_in_either_direction_are_refused(self):
        for parent, member in (('fixture_parent', ROLE), (ROLE, 'fixture_parent')):
            with self.subTest(parent=parent, member=member):
                self.sql(f'GRANT {parent} TO {member};')
                self.assert_refused('role memberships differ')
                self.sql(f'REVOKE {parent} FROM {member};')

    def test_changed_definition_is_refused_before_role_alteration(self):
        self.sql('CREATE OR REPLACE FUNCTION piggyvest_staging.resolve_wallet_mapping('
                 'p_integration_id uuid, p_provider_wallet_id text, p_provider_customer_id text) '
                 'RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT false $$;')
        self.assert_refused('executable function set differs')

    def test_missing_execute_grant_is_refused(self):
        self.sql(f'REVOKE EXECUTE ON FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid,text,text) FROM {ROLE};')
        self.assert_refused('executable function set differs')

    def test_changed_function_owner_is_refused_even_when_definition_hash_is_unchanged(self):
        self.sql('ALTER FUNCTION piggyvest_staging.resolve_wallet_mapping(uuid,text,text) OWNER TO fixture_parent;')
        self.assert_refused('executable function set differs')

    def test_unsafe_role_attributes_and_login_or_inherit_drift_are_refused(self):
        for unsafe, restore in (('SUPERUSER', 'NOSUPERUSER'), ('BYPASSRLS', 'NOBYPASSRLS'),
                                ('CREATEROLE', 'NOCREATEROLE'), ('CREATEDB', 'NOCREATEDB'),
                                ('REPLICATION', 'NOREPLICATION'), ('INHERIT', 'NOINHERIT'), ('NOLOGIN', 'LOGIN')):
            with self.subTest(attribute=unsafe):
                self.sql(f'ALTER ROLE {ROLE} {unsafe};')
                self.assert_refused('role metadata differs')
                self.sql(f'ALTER ROLE {ROLE} {restore};')

    def test_unreviewed_finite_infinite_and_fractional_expiries_are_refused(self):
        for expiry in ('infinity', '-infinity', '2026-09-29T15:59:10Z',
                       '2026-10-07T15:59:10Z', '2026-10-06T15:59:10.001Z'):
            with self.subTest(expiry=expiry):
                self.sql(f"ALTER ROLE {ROLE} VALID UNTIL '{expiry}';")
                self.assert_refused('role metadata differs')

    def test_physical_system_read_only_database_and_effective_user_guards_refuse(self):
        self.assert_refused('database identity or transaction mode differs',
                            self.script().replace(self.system, '7685292944002592802'))
        self.assert_refused('database identity or transaction mode differs',
                            self.script().replace('BEGIN;', 'BEGIN READ ONLY;', 1))
        self.assert_refused('database identity or transaction mode differs', database='template1')
        self.assert_refused('database identity or transaction mode differs',
                            self.script().replace('BEGIN;', 'BEGIN; SET ROLE fixture_parent;', 1))


if __name__ == '__main__':
    unittest.main()
