import importlib.util
import json
from pathlib import Path
import sys
import unittest


HERE = Path(__file__).resolve().parent
CONTRACTS = HERE.parent / 'replay-complete-cutover-owner'
sys.path.insert(0, str(CONTRACTS))


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


FIXTURE = load('inspection_pg_fixture', CONTRACTS / 'financial_report.test.py')
SUBJECT = load('inspection_sql', HERE / 'inspection_sql.py') if (
    HERE / 'inspection_sql.py').exists() else None


class InspectionSqlTests(FIXTURE.FinancialReportTests):
    def test_application_inspection_retains_real_write_transaction_identity(self):
        self.assertIsNotNone(SUBJECT, 'precommit inspection query is missing')
        raw = (CONTRACTS / 'financial_report.sql').read_bytes()
        query = SUBJECT.inspection_sql(raw, 'application')
        query = query.replace(FIXTURE.PIN, self.system)
        rows = self.execute('BEGIN ISOLATION LEVEL READ COMMITTED; '
            "SET LOCAL timezone='UTC'; " + query + 'ROLLBACK;').strip().splitlines()
        self.assertEqual(len(rows), 1)
        record = json.loads(rows[0])
        self.assertEqual(record['kind'], 'application')
        self.assertIs(record['value']['appIdentity']['readOnly'], False)
        self.assertEqual(record['value']['appIdentity']['systemIdentifier'], self.system)
        self.assertEqual(record['value']['completedApplication']['operation']['projectionStatus'], 'applied')

    def test_precommit_query_does_not_create_a_readonly_report(self):
        self.assertIsNotNone(SUBJECT, 'precommit inspection query is missing')
        query = SUBJECT.inspection_sql((CONTRACTS / 'financial_report.sql').read_bytes(), 'application')
        rows = self.execute("BEGIN READ ONLY; SET LOCAL timezone='UTC'; "
            + query.replace(FIXTURE.PIN, self.system) + 'ROLLBACK;').strip().splitlines()
        self.assertEqual(rows, [])

    def test_unreviewed_source_cannot_add_transaction_or_psql_control(self):
        self.assertIsNotNone(SUBJECT, 'precommit inspection query is missing')
        original = (CONTRACTS / 'financial_report.sql').read_bytes()
        for source in (original + b'COMMIT;', original.replace(b'ROLLBACK;', b'COMMIT;'),
            b'\\! echo unsafe\n' + original):
            with self.subTest(source=source[-30:]):
                with self.assertRaisesRegex(ValueError, '^existing_projection_inspection_refused$'):
                    SUBJECT.inspection_sql(source, 'application')


if __name__ == '__main__':
    unittest.main()
