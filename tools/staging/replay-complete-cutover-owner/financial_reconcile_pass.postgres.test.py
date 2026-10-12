import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

from financial_reconcile_pass import ROW_QUERY


class RowWitnessPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parent.parent/'replay-claim-fence/postgres.test.py'
        spec = importlib.util.spec_from_file_location('reconcile_row_postgres', path)
        loaded = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loaded)
        cls.fixture_type = loaded.ClaimFencePostgresTests
        cls.fixture_type.setUpClass()
        cls.addClassCleanup(cls.fixture_type.tearDownClass)

    def test_readonly_server_object_pin_is_distinct_and_tied_to_full_singleton_array(self):
        harness = self.fixture_type('runTest')
        harness.setUp()
        self.addCleanup(harness.doCleanups)
        harness.sql("CREATE SCHEMA prefunded_card; CREATE TABLE prefunded_card.operations(id uuid,private text);")
        harness.sql("INSERT INTO prefunded_card.operations VALUES ('ff561046-58e7-428d-9163-f6e60b0dab65','preserved'),"
            "('d8bcf921-61b3-4647-90e2-5648e4d6967d','foreign');")
        raw = harness.sql('BEGIN READ ONLY;'+ROW_QUERY+'ROLLBACK;').stdout.strip()
        report = json.loads(raw)
        row = b'{"id": "ff561046-58e7-428d-9163-f6e60b0dab65", "private": "preserved"}'
        self.assertEqual(report['rowSha256'], hashlib.sha256(row).hexdigest())
        self.assertEqual(report['targetHash'], hashlib.sha256(b'['+row+b']').hexdigest())
        self.assertEqual(report['rowCount'], 1)
        self.assertNotIn('preserved', raw)
        self.assertEqual(harness.sql('SELECT count(*) FROM prefunded_card.operations;').stdout.strip(), '2')


if __name__ == '__main__':
    unittest.main()
