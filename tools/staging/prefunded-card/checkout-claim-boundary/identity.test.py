import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('claim_scratch', HERE / 'snapshot.test.py')
SCRATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCRATCH)


class IdentityTests(SCRATCH.Scratch):
    def test_production_physical_owner_guard_rejects_disposable_database_without_override(self):
        identity = (HERE / 'identity.sql').read_text().split('DO $locks$')[0]
        self.assertNotEqual(self.harness.system, SCRATCH.INSTALLER.SYSTEM)
        with self.assertRaisesRegex(RuntimeError, 'physical owner identity refused'):
            self.sql('BEGIN;' + identity + 'ROLLBACK;')

    def test_database_and_role_oid_guards_refuse_before_locks(self):
        for field, value in dict(database='wrong', databaseOid=1, roleOid=1).items():
            evidence = self.snapshot()
            evidence['identity'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'database or role differs'):
                self.sql('BEGIN;' + self.temporary_expected(evidence)
                    + 'DO $locks$' + (HERE / 'identity.sql').read_text().split('DO $locks$')[1] + 'ROLLBACK;')

    def test_physical_owner_guard_runs_before_any_temporary_ddl(self):
        source = SCRATCH.INSTALLER._source(None)
        evidence = self.snapshot()
        rendered = SCRATCH.INSTALLER._rollback(evidence, source)
        self.assertLess(rendered.index('DO $identity$'), rendered.index('CREATE TEMP TABLE'))
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'physical owner identity refused'):
            self.sql(rendered)
        after = self.snapshot()
        self.assertEqual(before['functions'], after['functions'])
        self.assertEqual(before['tableRows'], after['tableRows'])
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])


if __name__ == '__main__':
    unittest.main()
