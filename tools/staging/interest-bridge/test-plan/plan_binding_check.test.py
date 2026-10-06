import json
from pathlib import Path
import subprocess
import unittest

from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanBindingCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def validate_binding(self, payload, goal_id):
        source = Path(__file__).with_name('plan_binding_check.sql').read_text()
        literal = json.dumps(payload).replace("'", "''")
        return self.database.query('BEGIN;\n' + source +
            "\nSELECT pg_temp.plan_binding_check('" + literal + "'::jsonb,'" + goal_id + "'::uuid);\nROLLBACK;")

    def test_exact_goal_only_binding_validator_is_read_only_and_does_not_create_missing_rows(self):
        payload = self.database.payload(goal_only=True)
        goal_id = json.loads(self.database.query(build_sql('goal-apply', payload)))['goalId']
        before = self.database.inventory()
        self.validate_binding(payload, goal_id)
        self.assertEqual(before['stateMd5'], self.database.inventory()['stateMd5'])
        with self.assertRaises(subprocess.CalledProcessError):
            self.validate_binding(payload, 'aaaaaaaa-0000-4000-8000-000000000001')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.bindings'), '2')

    def test_validator_refuses_wrong_wallet_identity_without_rewriting_mapping(self):
        payload = self.database.payload(goal_only=True)
        goal_id = json.loads(self.database.query(build_sql('goal-apply', payload)))['goalId']
        payload['publicWalletId'] = 'different-wallet'
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.validate_binding(payload, goal_id)
        self.assertIn('immutable binding conflict', caught.exception.stderr)
        self.assertEqual(self.database.query("SELECT provider_wallet_id FROM piggyvest_staging.wallet_goal_mappings "
            "WHERE goal_id='" + goal_id + "'"), '01M3W0Y93XHJY9RPQ2G75X81WG')


if __name__ == '__main__':
    unittest.main()
