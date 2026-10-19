import json
import unittest

from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def test_inventory_is_read_only_and_contains_guard_role_acl_and_function_fingerprints(self):
        first = self.database.inventory()
        second = self.database.inventory()
        self.assertEqual(first['stateMd5'], second['stateMd5'])
        self.assertEqual(first['schemaMd5'], second['schemaMd5'])
        kinds = {entry['kind'] for entry in first['schema']}
        self.assertTrue({'function', 'role', 'policy', 'trigger', 'column', 'constraint', 'index'} <= kinds)
        self.assertEqual(first['oldGoal']['principalKobo'], 10000)
        self.assertEqual(first['companyBudgetKobo'], 10000)
        self.assertEqual(first['aggregateTreasuryBudgetKobo'], 10000)
        self.assertEqual(first['merchant']['published'], False)

    def test_hash_changes_for_indexes_and_trigger_enablement_not_only_table_rows(self):
        first = self.database.inventory()
        self.database.query('CREATE INDEX synthetic_price ON public.products(price)')
        second = self.database.inventory()
        self.assertNotEqual(first['schemaMd5'], second['schemaMd5'])
        self.assertEqual(first['stateMd5'], second['stateMd5'])

    def test_protected_state_covers_treasury_notification_and_old_goal_rows(self):
        for command in (
            'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=1',
            "INSERT INTO savings_notifications.outbox VALUES ('aaaaaaaa-0000-4000-8000-000000000001')",
            "UPDATE public.customer_savings_goals SET current_amount=99 WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'",
        ):
            self.database.reset()
            before = self.database.inventory()
            self.database.query(command)
            after = self.database.inventory()
            self.assertNotEqual(before['stateMd5'], after['stateMd5'])

    def test_required_live_input_query_executes_read_only_and_never_selects_credentials(self):
        from pathlib import Path
        query = Path(__file__).with_name('required-live-inputs.sql').read_text()
        before = self.database.inventory()
        result = json.loads(self.database.query(query))
        self.assertTrue(result['ownerMatches'])
        self.assertTrue(result['actorActive'])
        self.assertTrue(result['savingsEnabled'])
        self.assertEqual(result['oldGoal']['principalKobo'], 10000)
        self.assertEqual(before['stateMd5'], self.database.inventory()['stateMd5'])
        self.assertNotIn('rolpassword', query)


if __name__ == '__main__':
    unittest.main()
