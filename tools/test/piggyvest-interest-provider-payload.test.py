import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    'interest_bridge_harness', Path(__file__).with_name('piggyvest-interest-bridge.test.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
PAYLOAD = json.loads((bridge.ROOT / 'apps/web/src/schemas/piggyvest/interest-payout-success.fixture.json').read_text())
SIGNATURE = 'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'


class InterestProviderPayload(bridge.InterestDatabase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sql_file(bridge.ROOT / 'supabase/migrations/20261001140000_piggyvest_interest_existing_authority.sql')
        cls.sql("ALTER TABLE public.customer_savings_goals ADD COLUMN status text DEFAULT 'active'")
        cls.sql_file(bridge.ROOT / 'supabase/migrations/20261001230000_customer_savings_interest_policy.sql')
        cls.sql(f"""
          CREATE ROLE prefunded_treasury_operator LOGIN;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('{bridge.GOAL}', '{bridge.INTEGRATION}', '{bridge.MERCHANT}', '{bridge.CUSTOMER}',
             'prefunded_treasury_operator', true);
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            TO prefunded_treasury_operator;
          SET SESSION AUTHORIZATION prefunded_treasury_operator;
          SELECT piggyvest_savings_ledger.apply('{bridge.INTEGRATION}', '{bridge.MERCHANT}',
            '{bridge.CUSTOMER}', '{bridge.GOAL}', '{{"operationId":"60000000-0000-4000-8000-000000000001",
              "kind":"credit_principal","principalKobo":10000,"interestKobo":0,
              "evidenceId":"isolated-opening","referenceId":null}}');
          RESET SESSION AUTHORIZATION;
          REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            FROM prefunded_treasury_operator;
          GRANT EXECUTE ON FUNCTION {SIGNATURE} TO prefunded_treasury_operator;
        """)

    def test_provider_sample_credits_net_once_and_emits_one_customer_notification(self):
        data = PAYLOAD['eventData']
        breakdown = data['break_down']
        economics = dict(
            payoutId=data['id'], providerCustomerId=PAYLOAD['customer_id'],
            sourceWalletId=PAYLOAD['pvb_accrued_interest_wallet'],
            destinationWalletId=data['destination_wallet'], reference=data['reference'],
            amountKobo=data['amount'], grossKobo=breakdown['gross_interest_payout'],
            taxKobo=breakdown['withholding_tax'], netKobo=breakdown['net_interest_payout'],
            currency='NGN')
        self.assertEqual(economics['amountKobo'], 733)
        self.assertEqual(economics['grossKobo'], 814)
        self.assertEqual(economics['taxKobo'], 81)

        def apply(value=economics):
            return self.sql(f"SELECT piggyvest_savings_ledger.apply_interest_receipt("
                            f"'{bridge.INTEGRATION}', 'synthetic-account', '{self.system_id}', "
                            f"'{json.dumps(value)}', '{PAYLOAD['eventId']}')",
                            'prefunded_treasury_operator').strip()

        self.assertEqual(apply(), 'deferred')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts').strip(), '0')
        self.sql(f"""
          INSERT INTO piggyvest_savings_ledger.interest_policies
            (integration_id,provider_business_id,provider_customer_id,interest_source_wallet_id,
             payout_wallet_id,merchant_id,customer_id,goal_id,interest_enabled,
             eligibility_evidence,policy_reference,expires_at,enabled)
          VALUES ('{bridge.INTEGRATION}', 'synthetic-account', '{economics['providerCustomerId']}',
            '{economics['sourceWalletId']}', '{economics['destinationWalletId']}', '{bridge.MERCHANT}',
            '{bridge.CUSTOMER}', '{bridge.GOAL}', true,
            'isolated-provider-sample-not-live-evidence', 'isolated-full-net-allocation',
            clock_timestamp()+interval '1 hour', true);
        """)
        self.assertEqual(apply({**economics, 'providerCustomerId': 'different-customer'}), 'deferred')
        self.assertEqual(apply({**economics, 'destinationWalletId': 'different-wallet'}), 'deferred')
        self.assertEqual(apply({**economics, 'taxKobo': 82}), 'invalid')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations').strip(), '0')
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda attempt: apply(), range(8)))
        self.assertEqual(results.count('applied'), 1)
        self.assertEqual(results.count('duplicate'), 7)
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts').strip(), '1')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.interest_allocations').strip(), '1')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings "
                                 "WHERE account='principal'").strip(), '10000')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings "
                                 "WHERE account='paid_interest'").strip(), '733')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings "
                                 "WHERE account IN ('principal','paid_interest')").strip(), '10733')
        self.assertEqual(self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{bridge.USER}'; "
                                 f"SELECT public.get_customer_savings_earnings('{bridge.MERCHANT}')->>'credited_interest_kobo'; "
                                 "ROLLBACK;").splitlines()[-2], '733')
        earnings = self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{bridge.USER}'; "
                            f"SELECT public.get_customer_savings_earnings('{bridge.MERCHANT}',true); ROLLBACK;")
        self.assertEqual(json.loads(earnings.splitlines()[-2]), {
            'credited_interest_kobo': 733,
            'goal_interest_kobo': [{'goal_id': bridge.GOAL, 'credited_interest_kobo': 733}],
        })
        inbox = self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{bridge.USER}'; "
                         f"SELECT public.get_customer_savings_notifications('{bridge.MERCHANT}'); ROLLBACK;")
        notifications = json.loads(inbox.splitlines()[-2])['notifications']
        self.assertEqual(len(notifications), 1)
        self.assertEqual(notifications[0]['type'], 'interest_credited')
        self.assertEqual(notifications[0]['goalId'], bridge.GOAL)
        self.assertIn('₦7.33', notifications[0]['body'])
        self.assertNotIn('₦8.14', notifications[0]['body'])
        self.shell([bridge.BIN / 'pg_ctl', '-D', self.path / 'data', '-m', 'fast', 'stop'])
        self.start()
        self.assertEqual(apply(), 'duplicate')
        self.assertEqual(self.sql("SELECT count(*) FROM savings_notifications.events "
                                 "WHERE type='interest_credited'").strip(), '1')
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings "
                                 "WHERE account='paid_interest'").strip(), '733')


if __name__ == '__main__':
    unittest.main()
