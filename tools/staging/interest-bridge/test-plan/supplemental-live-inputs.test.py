import json
from pathlib import Path
import unittest

from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class SupplementalInventoryTests(unittest.TestCase):
    def test_actual_catalogue_guard_hashes_and_noninheritable_memberships_are_reported(self):
        database = PlanTestDatabase()
        try:
            query = Path(__file__).with_name('supplemental-live-inputs.sql').read_text()
            result = json.loads(database.query(query))
            self.assertEqual({record['definitionMd5'] for record in result['guards']},
                             {'62aa3b6f886a8118e3e1e52fe5f1349a', 'c5c16d6de0901a84dfb0f96176fb57a0'})
            self.assertEqual(len(result['memberships']), 2)
            self.assertTrue(all(record['grantor'] == 'supabase_admin' and record['set']
                                and not record['admin'] and not record['inherit']
                                for record in result['memberships']))
            self.assertFalse(result['roleInherit'])
            self.assertFalse(result['directApply'])
            self.assertFalse(result['directApplyBound'])
        finally:
            database.close()


if __name__ == '__main__':
    unittest.main()
