import importlib.util
from pathlib import Path
import unittest


DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parents[2]
spec = importlib.util.spec_from_file_location('installer', DIRECTORY / 'install-schema.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InactiveSchema(unittest.TestCase):
    def setUp(self):
        self.migrations = {name: (ROOT / 'supabase/migrations' / name).read_bytes()
                           for name in installer.PINS}
        self.template = (DIRECTORY / 'schema-guard.sql').read_text()

    def test_default_candidate_rehearses_in_one_rollback_transaction(self):
        candidate = installer.render_sql(self.migrations, self.template)
        self.assertEqual(candidate.count('BEGIN;'), 1)
        self.assertNotIn('COMMIT;', candidate)
        self.assertTrue(candidate.endswith('ROLLBACK;\n'))
        self.assertNotIn('GRANT ', candidate)
        self.assertNotIn('CREATE ROLE', candidate)
        self.assertNotIn('__', candidate)
        self.assertIn('7685292944002592802', candidate)
        self.assertIn('interest_protected_state()', candidate)

    def test_commit_requires_explicit_apply(self):
        candidate = installer.render_sql(self.migrations, self.template, apply=True)
        self.assertEqual(candidate.count('COMMIT;'), 1)
        self.assertNotIn('ROLLBACK;', candidate)
        self.assertIn("'prefunded_treasury_operator'", candidate)

    def test_tampered_migration_is_rejected_before_any_database_access(self):
        for name in self.migrations:
            with self.subTest(name=name), self.assertRaises(ValueError):
                installer.render_sql({**self.migrations, name: self.migrations[name] + b'\n'}, self.template)

    def test_missing_or_duplicate_guard_marker_refused(self):
        for marker in ('__MIGRATIONS__', '__AUTHORITY_MD5__', '__FINISH__'):
            for template in (self.template.replace(marker, ''), self.template + marker):
                with self.subTest(marker=marker), self.assertRaises(ValueError):
                    installer.render_sql(self.migrations, template)

    def test_guard_content_tampering_is_refused_with_all_markers_intact(self):
        with self.assertRaises(ValueError):
            installer.render_sql(self.migrations, self.template.replace('10000', '9999'))

    def test_guard_checks_all_nonowner_acl_entries_and_serializes_parent_ddl(self):
        candidate = installer.render_sql(self.migrations, self.template)
        self.assertIn('permission.grantee<>routine.proowner', candidate)
        self.assertIn('permission.grantee<>relation.relowner', candidate)
        self.assertLess(candidate.index('LOCK TABLE pg_catalog.pg_proc'),
                        candidate.index('CREATE TABLE piggyvest_savings_ledger.interest_allocations'))
        self.assertIn('interest parent function postcondition refused', candidate)

    def test_guard_refuses_effective_worker_access_and_locks_membership_changes(self):
        candidate = installer.render_sql(self.migrations, self.template)
        self.assertIn('LOCK TABLE pg_catalog.pg_auth_members,pg_catalog.pg_authid IN SHARE MODE', candidate)
        self.assertIn("pg_has_role(login.oid,routine.proowner,'MEMBER')", candidate)
        self.assertIn("pg_has_role(login.oid,relation.relowner,'MEMBER')", candidate)
        self.assertIn('has_function_privilege(login.oid,routine.oid', candidate)
        self.assertIn('has_table_privilege(login.oid,relation.oid', candidate)


if __name__ == '__main__':
    unittest.main()
