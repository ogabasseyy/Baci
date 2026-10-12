import importlib.util
from pathlib import Path
import unittest


DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parents[2]
spec = importlib.util.spec_from_file_location('policy_installer', DIRECTORY / 'install-policy.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InterestPolicyInstaller(unittest.TestCase):
    def setUp(self):
        self.migration = (ROOT / 'supabase/migrations' / installer.MIGRATION_NAME).read_bytes()
        self.guard = (DIRECTORY / 'policy-guard.sql').read_text()

    def test_rehearses_and_only_adds_customer_scoped_read_access(self):
        source = installer.render_sql(self.migration, self.guard)
        self.assertEqual(source.count('BEGIN;'), 1)
        self.assertNotIn('COMMIT;', source)
        self.assertTrue(source.endswith('ROLLBACK;\n'))
        self.assertNotIn(' TO prefunded_treasury_operator', source)
        self.assertNotIn('CREATE ROLE', source)
        self.assertNotIn('__', source)
        self.assertIn('interest_policy_protected_state()', source)

    def test_commit_is_explicit_and_checks_the_exact_function_bodies(self):
        source = installer.render_sql(self.migration, self.guard, apply=True)
        self.assertEqual(source.count('COMMIT;'), 1)
        self.assertNotIn('ROLLBACK;', source)
        self.assertIn("md5(routine.prosrc)<>expected.body_md5", source)
        self.assertIn("'public.get_customer_savings_earnings(uuid,boolean)'", source)

    def test_tampering_refuses_before_database_contact(self):
        for migration, guard in [(self.migration+b'\n', self.guard),
                                 (self.migration, self.guard.replace('current_amount=100', 'current_amount=0'))]:
            with self.subTest(guard=guard == self.guard), self.assertRaises(ValueError):
                installer.render_sql(migration, guard)


if __name__ == '__main__':
    unittest.main()
