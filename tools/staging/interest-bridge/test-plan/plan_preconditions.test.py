import subprocess
import unittest
from datetime import datetime, timedelta, timezone

from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanPreconditionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def assert_refuses_without_creation(self, payload, message):
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('apply', payload))
        self.assertIn(message, caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.interest_policies'), '0')

    def test_physical_identity_deadline_and_stale_fresh_get_each_refuse(self):
        original = self.database.payload()
        for field, value in (
            ('systemIdentifier', 'different-physical-database'),
            ('expiresAt', '2026-10-01T00:00:00Z'),
            ('providerRetrievedAt', (datetime.now(timezone.utc)-timedelta(seconds=91)).isoformat()),
        ):
            payload = {**original, field: value}
            self.assert_refuses_without_creation(payload, 'fresh evidence refused')

    def test_snapshot_row_drift_refuses_before_official_creation(self):
        payload = self.database.payload()
        self.database.query('UPDATE prefunded_card.treasury_bindings SET consumed_kobo=1')
        self.assert_refuses_without_creation(payload, 'schema or state drift')

    def test_schema_drift_refuses_after_snapshot_without_bypassing_a_guard(self):
        payload = self.database.payload()
        self.database.query('ALTER TABLE public.customer_savings_goals ADD COLUMN synthetic_drift text')
        self.assert_refuses_without_creation(payload, 'schema or state drift')

    def test_owner_change_and_disabled_integration_refuse_even_with_a_new_snapshot(self):
        for command in (
            "UPDATE public.customers SET user_id=NULL",
            'UPDATE piggyvest_staging.integrations SET enabled=false',
            'UPDATE auth.users SET deleted_at=clock_timestamp()',
        ):
            self.database.reset()
            self.database.query(command)
            self.assert_refuses_without_creation(self.database.payload(), 'historical binding refused')

    def test_merchant_feature_guard_is_called_authenticated_and_never_disabled(self):
        self.database.query('UPDATE public.merchant_feature_settings SET customer_device_savings_enabled=false')
        self.assert_refuses_without_creation(self.database.payload(), 'savings feature disabled')

    def test_role_direct_policy_access_refuses_and_does_not_grant_anything(self):
        self.database.query('GRANT SELECT ON piggyvest_savings_ledger.interest_policies TO prefunded_treasury_operator')
        self.assert_refuses_without_creation(self.database.payload(), 'restricted binding refused')

    def test_foreign_wallet_mapping_cannot_be_adopted_or_overwritten(self):
        self.database.query("""
          INSERT INTO public.customer_savings_goals(merchant_id,customer_id,product_id,title,target_amount,
            contribution_amount,contribution_frequency,start_date,maturity_date,source_mode,
            terms_accepted_at,non_withdrawable_accepted_at)
          SELECT merchant_id,customer_id,product_id,'Unrelated empty goal',target_amount,
            1,'daily',start_date,maturity_date,'manual',terms_accepted_at,non_withdrawable_accepted_at
          FROM public.customer_savings_goals;
          INSERT INTO piggyvest_staging.wallet_goal_mappings
          SELECT integration_id,'01M3W0Y93XHJY9RPQ2G75X81WG',provider_customer_id,
            merchant_id,customer_id,(SELECT id FROM public.customer_savings_goals WHERE title='Unrelated empty goal')
          FROM piggyvest_staging.wallet_goal_mappings;
        """)
        payload = self.database.payload()
        with self.assertRaises(subprocess.CalledProcessError):
            self.database.query(build_sql('apply', payload))
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '2')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_staging.wallet_goal_mappings'), '2')


if __name__ == '__main__':
    unittest.main()
