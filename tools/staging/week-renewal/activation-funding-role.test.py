import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from activation_evidence import funding_role
from renewal_contract import SYSTEM, TARGET_EPOCH, Refused


SOURCE = Path(__file__).with_name('activation-funding-role.sql')


class FundingRolePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('pg_config'):
            raise unittest.SkipTest('A local PostgreSQL fixture runtime is unavailable')
        cls.binaries = Path(subprocess.check_output(['pg_config', '--bindir'], text=True).strip())
        if not all((cls.binaries / name).is_file() for name in ('initdb', 'pg_ctl', 'psql')):
            raise unittest.SkipTest('A local PostgreSQL fixture runtime is incomplete')
        temporary_parent = '/private/tmp' if Path('/private/tmp').is_dir() else '/tmp'
        cls.temporary = tempfile.TemporaryDirectory(prefix='baci-role-fixture-', dir=temporary_parent)
        cls.root = Path(cls.temporary.name)
        cls.data = cls.root / 'data'
        cls.socket = cls.root / 'socket'
        cls.socket.mkdir(mode=0o700)
        subprocess.run([str(cls.binaries / 'initdb'), '-D', str(cls.data), '-U', 'postgres',
                        '-A', 'trust', '-E', 'UTF8', '--no-locale'], capture_output=True, check=True, timeout=30)
        try:
            subprocess.run([str(cls.binaries / 'pg_ctl'), '-D', str(cls.data), '-l', str(cls.root / 'postgres.log'),
                            '-o', f"-k {cls.socket} -h '' -p 65491", '-w', 'start'],
                           capture_output=True, check=True, timeout=30)
            cls.system = cls.sql('SELECT system_identifier FROM pg_control_system();').strip()
            cls.statement = SOURCE.read_text().replace(SYSTEM, cls.system)
        except Exception:
            if (cls.data / 'postmaster.pid').exists():
                subprocess.run([str(cls.binaries / 'pg_ctl'), '-D', str(cls.data), '-m', 'fast', '-w', 'stop'],
                               capture_output=True, timeout=30)
            cls.temporary.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        subprocess.run([str(cls.binaries / 'pg_ctl'), '-D', str(cls.data), '-m', 'fast', '-w', 'stop'],
                       capture_output=True, check=True, timeout=30)
        cls.temporary.cleanup()

    @classmethod
    def sql(cls, statement):
        result = subprocess.run([str(cls.binaries / 'psql'), '-h', str(cls.socket), '-p', '65491',
                                 '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
                                input=statement, text=True, capture_output=True, timeout=15)
        if result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout

    def setUp(self):
        self.sql('DROP SCHEMA IF EXISTS piggyvest_staging CASCADE; '
                 'DROP ROLE IF EXISTS piggyvest_staging_provisioner;')

    def report(self):
        value = json.loads(self.sql(self.statement))
        self.assertEqual(value['systemIdentifier'], self.system)
        self.assertTrue(value['readOnly'])
        return {**value, 'systemIdentifier': SYSTEM}

    def test_actual_catalog_query_handles_absent_worker(self):
        self.assertFalse(funding_role(self.report())['present'])

    def test_actual_catalog_query_reports_scoped_functions_and_expiry(self):
        self.sql("CREATE ROLE piggyvest_staging_provisioner LOGIN NOINHERIT VALID UNTIL '2026-10-06T15:59:10Z';"
                 'CREATE SCHEMA piggyvest_staging; '
                 'CREATE FUNCTION piggyvest_staging.fixture_probe() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; '
                 'REVOKE ALL ON FUNCTION piggyvest_staging.fixture_probe() FROM PUBLIC; '
                 'GRANT EXECUTE ON FUNCTION piggyvest_staging.fixture_probe() TO piggyvest_staging_provisioner;')
        report = self.report()
        result = funding_role(report)
        self.assertEqual(result['expiresAtEpoch'], TARGET_EPOCH)
        self.assertTrue(result['coversRequestedDeadline'])
        self.assertEqual(len(result['functions']), 1)
        self.assertEqual(result['functions'][0]['name'], 'fixture_probe')

    def test_infinite_or_expired_login_is_not_treated_as_reviewed_week(self):
        for expiry in ('infinity', '2026-09-29T15:59:10Z'):
            self.sql("CREATE ROLE piggyvest_staging_provisioner LOGIN VALID UNTIL '" + expiry + "';")
            self.assertFalse(funding_role(self.report())['coversRequestedDeadline'])
            self.sql('DROP ROLE piggyvest_staging_provisioner;')

    def test_unsafe_membership_is_visible_and_refused(self):
        self.sql('CREATE ROLE fixture_unsafe_parent CREATEROLE; '
                 'CREATE ROLE piggyvest_staging_provisioner LOGIN; '
                 'GRANT fixture_unsafe_parent TO piggyvest_staging_provisioner;')
        try:
            report = self.report()
            self.assertTrue(report['role']['unsafeMembership'])
            with self.assertRaises(Refused):
                funding_role(report)
        finally:
            self.sql('REVOKE fixture_unsafe_parent FROM piggyvest_staging_provisioner; '
                     'DROP ROLE fixture_unsafe_parent;')

    def test_predefined_file_and_program_roles_are_not_safe_memberships(self):
        self.sql('CREATE ROLE piggyvest_staging_provisioner LOGIN;')
        for name in ('pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files'):
            self.sql('GRANT ' + name + ' TO piggyvest_staging_provisioner;')
            try:
                report = self.report()
                self.assertTrue(report['role']['unsafeMembership'])
                with self.assertRaises(Refused):
                    funding_role(report)
            finally:
                self.sql('REVOKE ' + name + ' FROM piggyvest_staging_provisioner;')


if __name__ == '__main__':
    unittest.main()
