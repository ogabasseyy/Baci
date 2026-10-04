import importlib.util
from pathlib import Path
import unittest


SPECIFICATION = importlib.util.spec_from_file_location(
    'legacy_role_fixture', Path(__file__).with_name('legacy-enrollment-local.test.py')
)
FIXTURE = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(FIXTURE)


class LegacyRoleContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        FIXTURE.LegacyEnrollment.setUpClass()
        FIXTURE.LegacyEnrollment.sql('CREATE ROLE unexpected_migration_role NOLOGIN')

    @classmethod
    def tearDownClass(cls):
        FIXTURE.LegacyEnrollment.tearDownClass()

    def test_accepts_only_installed_memberships_without_expanding_privileges(self):
        fixture = FIXTURE.LegacyEnrollment()
        cases = (
            ('extra capability',
             'GRANT unexpected_migration_role TO prefunded_treasury_operator',
             'REVOKE unexpected_migration_role FROM prefunded_treasury_operator'),
            ('evidence membership',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_evidence',
             'REVOKE prefunded_treasury_ledger_worker FROM prefunded_evidence'),
            ('incoming operator membership',
             'GRANT prefunded_treasury_operator TO unexpected_migration_role',
             'REVOKE prefunded_treasury_operator FROM unexpected_migration_role'),
            ('transitive capability',
             'GRANT unexpected_migration_role TO prefunded_treasury_ledger_worker',
             'REVOKE unexpected_migration_role FROM prefunded_treasury_ledger_worker'),
            ('admin delegation',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator WITH ADMIN TRUE',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator WITH ADMIN FALSE'),
            ('automatic inheritance',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator WITH INHERIT TRUE',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator WITH INHERIT FALSE'),
            ('missing set permission',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator WITH SET FALSE',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator WITH SET TRUE'),
            ('missing required membership',
             'REVOKE prefunded_treasury_ledger_worker FROM prefunded_treasury_operator',
             'GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator'),
            ('enabled login',
             'ALTER ROLE prefunded_evidence LOGIN', 'ALTER ROLE prefunded_evidence NOLOGIN'),
            ('executor inheritance',
             'ALTER ROLE prefunded_treasury_operator INHERIT',
             'ALTER ROLE prefunded_treasury_operator NOINHERIT'),
            ('unsafe capability role',
             'ALTER ROLE prefunded_card_authorization_reader CREATEROLE',
             'ALTER ROLE prefunded_card_authorization_reader NOCREATEROLE'),
        )
        for name, change, restore in cases:
            with self.subTest(name=name):
                fixture.sql(change)
                try:
                    failed = fixture.run_candidate(fixture.proof(), check=False)
                    self.assertNotEqual(failed.returncode, 0)
                    self.assertIn('restricted session identities refused', failed.stderr)
                    self.assertEqual(fixture.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '0')
                    self.assertEqual(fixture.sql('SELECT current_amount FROM public.customer_savings_goals'), '100.00')
                finally:
                    fixture.sql(restore)
        fixture.sql('GRANT prefunded_treasury_ledger_worker, prefunded_card_authorization_reader TO unexpected_migration_role')
        self.assertEqual(fixture.sql(
            "SELECT pg_has_role('unexpected_migration_role','prefunded_treasury_operator','MEMBER')"
        ), 'f')
        result = fixture.run_candidate(fixture.proof())
        self.assertEqual(result.stdout.strip().splitlines()[-1], 'migrated')
        self.assertEqual(fixture.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '1')
        self.assertEqual(fixture.sql('SELECT count(*) FROM public.customer_savings_contributions'), '1')
        self.assertEqual(fixture.sql('SELECT count(*) FROM prefunded_card.credit_routes'), '0')


if __name__ == '__main__':
    unittest.main()
