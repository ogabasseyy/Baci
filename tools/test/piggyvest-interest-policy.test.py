import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import unittest


spec = importlib.util.spec_from_file_location(
    'interest_bridge_harness', Path(__file__).with_name('piggyvest-interest-bridge.test.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
SIGNATURE = 'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'
ECONOMICS = dict(payoutId='policy-payout', providerCustomerId='verified-customer',
                 sourceWalletId='verified-interest-source', destinationWalletId='verified-destination',
                 reference='provider-reference', amountKobo=733, grossKobo=814,
                 taxKobo=81, netKobo=733, currency='NGN')


class InterestPolicy(bridge.InterestDatabase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sql_file(bridge.ROOT / 'supabase/migrations/20261001140000_piggyvest_interest_existing_authority.sql')
        cls.sql("ALTER TABLE public.customer_savings_goals ADD COLUMN status text DEFAULT 'active'")
        migration = bridge.ROOT / 'supabase/migrations/20261001230000_customer_savings_interest_policy.sql'
        if migration.exists():
            cls.sql_file(migration)

    def test_allocates_verified_net_automatically_and_projects_each_goal_without_double_credit(self):
        self.assertEqual(self.sql("SELECT to_regclass('piggyvest_savings_ledger.interest_policies') IS NOT NULL").strip(), 't')
        self.sql(f"""
          CREATE ROLE prefunded_treasury_operator LOGIN;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
          GRANT EXECUTE ON FUNCTION {SIGNATURE} TO prefunded_treasury_operator;
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('{bridge.GOAL}','{bridge.INTEGRATION}','{bridge.MERCHANT}','{bridge.CUSTOMER}',
              'prefunded_treasury_operator',true);
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            TO prefunded_treasury_operator;
          SET SESSION AUTHORIZATION prefunded_treasury_operator;
          SELECT piggyvest_savings_ledger.apply('{bridge.INTEGRATION}', '{bridge.MERCHANT}',
            '{bridge.CUSTOMER}', '{bridge.GOAL}', '{{"operationId":"60000000-0000-4000-8000-000000000005",
              "kind":"credit_principal","principalKobo":10000,"interestKobo":0,
              "evidenceId":"isolated-opening","referenceId":null}}');
          RESET SESSION AUTHORIZATION;
          REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            FROM prefunded_treasury_operator;
        """)

        def apply(value=ECONOMICS, business='synthetic-account'):
            return self.sql(f"SELECT piggyvest_savings_ledger.apply_interest_receipt("
                            f"'{bridge.INTEGRATION}','{business}','{self.system_id}',"
                            f"'{json.dumps(value)}','policy-event')",
                            'prefunded_treasury_operator').strip()

        def count(table):
            return self.sql(f'SELECT count(*) FROM piggyvest_savings_ledger.{table}').strip()

        legacy = self.sql(f"""
          BEGIN;
          INSERT INTO piggyvest_savings_ledger.interest_allocations
            (integration_id,provider_business_id,payout_id,merchant_id,customer_id,goal_id,
             economics,customer_amount_kobo,eligibility_evidence,policy_reference,enabled)
          VALUES ('{bridge.INTEGRATION}','synthetic-account','policy-payout','{bridge.MERCHANT}',
            '{bridge.CUSTOMER}','{bridge.GOAL}','{json.dumps(ECONOMICS)}',733,
            'old-manual-evidence','old-manual-policy',true);
          SET SESSION AUTHORIZATION prefunded_treasury_operator;
          SELECT piggyvest_savings_ledger.apply_interest_receipt('{bridge.INTEGRATION}',
            'synthetic-account','{self.system_id}','{json.dumps(ECONOMICS)}','legacy-policy-event');
          ROLLBACK;
        """)
        self.assertEqual(legacy.splitlines()[-2], 'deferred')
        self.assertEqual(apply(), 'deferred')
        self.sql(f"""
          INSERT INTO piggyvest_savings_ledger.interest_policies
            (integration_id,provider_business_id,provider_customer_id,interest_source_wallet_id,
             payout_wallet_id,merchant_id,customer_id,goal_id,interest_enabled,
             eligibility_evidence,policy_reference,expires_at)
          VALUES ('{bridge.INTEGRATION}','synthetic-account','verified-customer',
             'verified-interest-source','verified-destination','{bridge.MERCHANT}',
             '{bridge.CUSTOMER}','{bridge.GOAL}',true,'isolated-verified-wallet',
             'customer-wallet-full-net',clock_timestamp()+interval '1 hour');
        """)
        self.assertEqual(apply(), 'deferred')
        self.assertEqual(count('interest_allocations'), '0')
        self.sql('UPDATE piggyvest_savings_ledger.interest_policies SET enabled=true')
        for field in ['providerCustomerId', 'sourceWalletId', 'destinationWalletId']:
            self.assertEqual(apply({**ECONOMICS, field: 'wrong'}), 'deferred')
        self.assertEqual(apply(business='different-business'), 'deferred')
        self.assertEqual(apply({**ECONOMICS, 'taxKobo': 82}), 'invalid')
        self.sql("UPDATE public.customer_savings_goals SET status='cancelled'")
        self.assertEqual(apply(), 'deferred')
        self.sql("UPDATE public.customer_savings_goals SET status='active'")
        self.sql(f"UPDATE public.customers SET deleted_at=clock_timestamp() WHERE id='{bridge.CUSTOMER}'")
        self.assertEqual(apply(), 'deferred')
        self.sql(f"UPDATE public.customers SET deleted_at=null WHERE id='{bridge.CUSTOMER}'")
        self.assertEqual(count('interest_allocations'), '0')
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda attempt: apply(), range(8)))
        self.assertEqual(results.count('applied'), 1)
        self.assertEqual(results.count('duplicate'), 7)
        self.assertEqual(count('interest_allocations'), '1')
        self.assertEqual(count('interest_receipts'), '1')
        self.assertEqual(apply({**ECONOMICS, 'reference': 'changed'}), 'conflict')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal'").strip(), '10000')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='paid_interest'").strip(), '733')
        earnings = self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{bridge.USER}'; "
                            f"SELECT public.get_customer_savings_earnings('{bridge.MERCHANT}',true); ROLLBACK;")
        self.assertEqual(json.loads(earnings.splitlines()[-2]), {
            'credited_interest_kobo': 733,
            'goal_interest_kobo': [{'goal_id': bridge.GOAL, 'credited_interest_kobo': 733}],
        })
        legacy = self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{bridge.USER}'; "
                          f"SELECT public.get_customer_savings_earnings('{bridge.MERCHANT}'); ROLLBACK;")
        self.assertEqual(json.loads(legacy.splitlines()[-2]), {'credited_interest_kobo': 733})
        self.sql("""
          CREATE FUNCTION public.reject_isolated_interest_receipt() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated receipt rejection'; END $$;
          CREATE TRIGGER isolated_receipt_rejection BEFORE INSERT ON piggyvest_savings_ledger.interest_receipts
            FOR EACH ROW EXECUTE FUNCTION public.reject_isolated_interest_receipt();
        """)
        with self.assertRaises(subprocess.CalledProcessError):
            apply({**ECONOMICS, 'payoutId': 'rollback-payout'})
        self.assertEqual(count('interest_allocations'), '1')
        self.assertEqual(count('interest_receipts'), '1')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='paid_interest'").strip(), '733')
        self.assertEqual(self.sql("SELECT count(*) FROM savings_notifications.events WHERE type='interest_credited'").strip(), '1')
        self.sql("DROP TRIGGER isolated_receipt_rejection ON piggyvest_savings_ledger.interest_receipts; DROP FUNCTION public.reject_isolated_interest_receipt()")
        self.sql("UPDATE piggyvest_savings_ledger.interest_policies SET expires_at=clock_timestamp()-interval '1 second'")
        self.assertEqual(apply({**ECONOMICS, 'payoutId': 'next-month'}), 'deferred')
        self.assertEqual(count('interest_allocations'), '1')
        self.assertEqual(self.sql("SELECT count(*) FROM savings_notifications.events WHERE type='interest_credited'").strip(), '1')
        for login in ['anon', 'authenticated', 'service_role', 'prefunded_treasury_operator']:
            self.assertEqual(self.sql(f"SELECT has_table_privilege('{login}',"
                                     "'piggyvest_savings_ledger.interest_policies','INSERT')").strip(), 'f')
        self.assertEqual(self.sql("SELECT has_function_privilege('prefunded_treasury_operator',"
            "'piggyvest_savings_ledger.prepare_interest_allocation(uuid,text,jsonb)','EXECUTE')").strip(), 'f')


if __name__ == '__main__':
    unittest.main()
