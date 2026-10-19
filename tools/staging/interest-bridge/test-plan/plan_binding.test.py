import json
from concurrent.futures import ThreadPoolExecutor
import subprocess
import unittest

from plan_constants import PLAN_KEY
from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanBindingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def test_rehearsal_rolls_back_all_four_objects_and_preserves_old_goal_and_treasury(self):
        payload = self.database.payload()
        before = self.database.inventory()
        result = json.loads(self.database.query(build_sql('rehearse', payload)))
        after = self.database.inventory()
        self.assertTrue(result['interestPolicyEnabled'])
        self.assertEqual(result['principalKobo'], 0)
        self.assertEqual(before['stateMd5'], after['stateMd5'])
        self.assertEqual(before['schemaMd5'], after['schemaMd5'])
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')

    def test_commit_is_exact_enabled_and_repeat_is_idempotent_without_funding_or_remapping(self):
        payload = self.database.payload()
        first = json.loads(self.database.query(build_sql('apply', payload)))
        second = json.loads(self.database.query(build_sql('apply', payload)))
        self.assertEqual(first['goalId'], second['goalId'])
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '2')
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_contributions'), '0')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '0')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.interest_policies WHERE enabled'), '1')
        self.assertEqual(self.database.query("SELECT provider_wallet_id FROM piggyvest_staging.wallet_goal_mappings WHERE goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'"), '01M3CQX27G9687EFSF1TKYMPR9')

    def test_goal_only_rehearsal_rolls_back_and_apply_retries_keep_policy_absent(self):
        payload = self.database.payload(goal_only=True)
        before = self.database.inventory()
        rehearsal = json.loads(self.database.query(build_sql('goal-rehearse', payload)))
        self.assertEqual(rehearsal['status'], 'exact_empty_goal_bound_policy_pending')
        self.assertFalse(rehearsal['interestPolicyPresent'])
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_staging.wallet_goal_mappings'), '1')
        with ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(lambda _: json.loads(self.database.query(
                build_sql('goal-apply', payload))), range(3)))
        self.assertEqual(len({result['goalId'] for result in results}), 1)
        self.assertNotEqual(results[0]['goalId'], payload['oldGoalId'])
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.interest_policies'), '0')
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_contributions'), '0')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '0')
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_events'), '1')
        self.assertEqual(self.database.query("SELECT provider_wallet_id||'/'||provider_customer_id FROM piggyvest_staging.wallet_goal_mappings WHERE goal_id<> '430314fd-cd8b-4579-98d4-e9f345713dd6'"),
            payload['publicWalletId'] + '/' + payload['webhookCustomerId'])
        self.assertEqual(self.database.query("SELECT bool_and(current_amount=0 AND metadata->>'interestOptIn'='true') FROM public.customer_savings_goals WHERE id<>'430314fd-cd8b-4579-98d4-e9f345713dd6'"), 't')
        after = self.database.inventory()
        self.assertEqual(before['stateMd5'], after['stateMd5'])
        self.assertEqual(before['schemaMd5'], after['schemaMd5'])

    def test_goal_only_refuses_existing_enabled_or_disabled_policy_without_deleting_it(self):
        payload = self.database.payload()
        self.database.query(build_sql('apply', payload))
        for enabled in ('true', 'false'):
            self.database.query('UPDATE piggyvest_savings_ledger.interest_policies SET enabled=' + enabled)
            goal_payload = self.database.payload(goal_only=True)
            goal_payload['metadata'] = payload['metadata']
            goal_payload['acceptedAt'] = payload['acceptedAt']
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                self.database.query(build_sql('goal-apply', goal_payload))
            self.assertIn('goal only policy must be absent', caught.exception.stderr)
            self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.interest_policies'), '1')

    def test_goal_only_refuses_new_snapshot_after_company_treasury_cap_increases(self):
        self.database.query('UPDATE prefunded_card.treasury_bindings SET verified_available_kobo=10001')
        payload = self.database.payload(goal_only=True)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('goal-apply', payload))
        self.assertIn('treasury cap refused', caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')

    def test_goal_only_cannot_treat_total_treasury_cap_as_per_binding_allowance(self):
        self.database.query("INSERT INTO prefunded_card.treasury_bindings VALUES ('aaaaaaaa-0000-4000-8000-000000000001',10000,0,0,true)")
        payload = self.database.payload(goal_only=True)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('goal-apply', payload))
        self.assertIn('treasury cap refused', caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')

    def test_goal_only_rolls_back_policy_inserted_by_deferred_trigger(self):
        self.database.query("""
          CREATE FUNCTION public.synthetic_deferred_policy() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            INSERT INTO piggyvest_savings_ledger.interest_policies(goal_id,integration_id,merchant_id,
              customer_id,provider_business_id,provider_customer_id,interest_source_wallet_id,
              payout_wallet_id,interest_enabled,eligibility_evidence,policy_reference,expires_at,enabled)
            VALUES(NEW.goal_id,NEW.integration_id,NEW.merchant_id,NEW.customer_id,
              '01M2381RG34HQJMHQKE7DWDACR','c096507d-dc32-45d2-9c01-871a27abfd10',
              'synthetic-source','synthetic-payout',true,'synthetic-proof','synthetic-policy',
              '2026-10-06T15:59:10Z',false);
            RETURN NEW;
          END $$;
          CREATE CONSTRAINT TRIGGER synthetic_deferred_policy AFTER INSERT
            ON piggyvest_savings_ledger.bindings DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION public.synthetic_deferred_policy();
        """)
        payload = self.database.payload(goal_only=True)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('goal-apply', payload))
        self.assertIn('goal only policy must be absent', caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.interest_policies'), '0')

    def test_concurrent_retries_create_exactly_one_goal_mapping_policy_and_event(self):
        payload = self.database.payload()
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: json.loads(self.database.query(build_sql('apply', payload))), range(4)))
        self.assertEqual(len({result['goalId'] for result in results}), 1)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_events'), '1')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.interest_policies'), '1')

    def test_policy_conflict_does_not_overwrite_mapping_or_enabled_configuration(self):
        payload = self.database.payload()
        self.database.query(build_sql('apply', payload))
        payload['payoutWalletId'] = 'different-destination'
        with self.assertRaises(subprocess.CalledProcessError):
            self.database.query(build_sql('apply', payload))
        self.assertEqual(self.database.query('SELECT payout_wallet_id FROM piggyvest_savings_ledger.interest_policies'),
                         'synthetic-independent-payout-wallet')

    def test_old_goal_metadata_collision_is_refused_without_remapping(self):
        self.database.query("UPDATE public.customer_savings_goals SET metadata=jsonb_build_object('stagingTestPlanKey','" + PLAN_KEY + "') WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'")
        payload = self.database.payload()
        try:
            with self.assertRaises(subprocess.CalledProcessError):
                self.database.query(build_sql('apply', payload))
            self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_staging.wallet_goal_mappings'), '1')
        finally:
            self.database.query("UPDATE public.customer_savings_goals SET metadata='{}' WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'")


if __name__ == '__main__':
    unittest.main()
