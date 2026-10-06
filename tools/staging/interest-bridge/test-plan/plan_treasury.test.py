import subprocess
import unittest

from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanTreasuryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def assert_refuses(self, payload, message):
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('goal-apply', payload))
        self.assertIn(message, caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')
        self.assertEqual(self.database.query('SELECT verified_available_kobo FROM prefunded_card.treasury_bindings'), '10000')

    def test_replenishment_cannot_hide_behind_unchanged_counters_and_new_snapshot(self):
        self.database.query("INSERT INTO prefunded_card.treasury_replenishments VALUES "
            "('aaaaaaaa-0000-4000-8000-000000000001','ffffcb16-2e95-5cff-a591-e9cc81cf5f57',1)")
        self.assert_refuses(self.database.payload(goal_only=True), 'treasury cap refused')

    def test_opening_identity_cannot_disagree_with_unchanged_counters_and_new_snapshot(self):
        self.database.query('UPDATE prefunded_card.treasury_identities SET opening_available_kobo=10001')
        self.assert_refuses(self.database.payload(goal_only=True), 'treasury cap refused')

    def test_replenishment_drift_after_inventory_refuses_before_creation(self):
        payload = self.database.payload(goal_only=True)
        self.database.query("INSERT INTO prefunded_card.treasury_replenishments VALUES "
            "('aaaaaaaa-0000-4000-8000-000000000001','ffffcb16-2e95-5cff-a591-e9cc81cf5f57',1)")
        self.assert_refuses(payload, 'schema or state drift')

    def test_company_source_identity_cannot_be_replaced_even_with_new_snapshot(self):
        self.database.query("UPDATE prefunded_card.treasury_identities SET source_wallet_id='another-company-wallet'")
        self.assert_refuses(self.database.payload(goal_only=True), 'treasury cap refused')


if __name__ == '__main__':
    unittest.main()
