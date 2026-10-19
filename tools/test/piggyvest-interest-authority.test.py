import importlib.util
import json
from pathlib import Path
import subprocess
import unittest


spec = importlib.util.spec_from_file_location(
    'interest_bridge_harness', Path(__file__).with_name('piggyvest-interest-bridge.test.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
GOAL = '30000000-0000-4000-8000-000000000002'
ECONOMICS = {**bridge.ECONOMICS, 'payoutId': 'treasury-interest'}
SIGNATURE = 'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'


class InterestAuthority(bridge.InterestBridge):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        migration = bridge.ROOT / 'supabase/migrations/20261001140000_piggyvest_interest_existing_authority.sql'
        if migration.exists():
            cls.sql_file(migration)

    def test_treasury_binding_accepts_interest_without_general_ledger_grants(self):
        self.sql(f"""
          CREATE ROLE prefunded_treasury_operator LOGIN;
          CREATE ROLE unrelated_interest_worker LOGIN;
          INSERT INTO public.customer_savings_goals VALUES
            ('{GOAL}', '{bridge.MERCHANT}', '{bridge.CUSTOMER}');
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('{GOAL}', '{bridge.INTEGRATION}', '{bridge.MERCHANT}', '{bridge.CUSTOMER}',
             'prefunded_treasury_operator', true);
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO prefunded_treasury_operator;
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            TO prefunded_treasury_operator;
          SET SESSION AUTHORIZATION prefunded_treasury_operator;
          SELECT piggyvest_savings_ledger.apply('{bridge.INTEGRATION}', '{bridge.MERCHANT}',
            '{bridge.CUSTOMER}', '{GOAL}', '{{"operationId":"60000000-0000-4000-8000-000000000002",
              "kind":"credit_principal","principalKobo":10000,"interestKobo":0,
              "evidenceId":"verified-opening","referenceId":null}}');
          RESET SESSION AUTHORIZATION;
          REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            FROM prefunded_treasury_operator;
          GRANT EXECUTE ON FUNCTION {SIGNATURE} TO prefunded_treasury_operator;
        """)

        def apply(economics=ECONOMICS, login='prefunded_treasury_operator'):
            return self.sql(f"SELECT piggyvest_savings_ledger.apply_interest_receipt("
                            f"'{bridge.INTEGRATION}', 'synthetic-account', '{self.system_id}', "
                            f"'{json.dumps(economics)}', 'treasury-event')", login).strip()

        self.assertEqual(apply(), 'deferred')
        self.sql(f"""
          INSERT INTO piggyvest_savings_ledger.interest_allocations
            (integration_id,provider_business_id,payout_id,merchant_id,customer_id,goal_id,
             economics,customer_amount_kobo,eligibility_evidence,policy_reference,enabled)
          VALUES ('{bridge.INTEGRATION}','synthetic-account','treasury-interest','{bridge.MERCHANT}',
            '{bridge.CUSTOMER}','{GOAL}','{json.dumps(ECONOMICS)}',900,
            'verified-provider-receipt','approved-customer-share',true);
        """)
        self.assertEqual(apply(), 'applied')
        self.assertEqual(apply(), 'duplicate')
        self.assertEqual(apply({**ECONOMICS, 'reference': 'different'}), 'conflict')
        self.sql(f"""
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='piggyvest_staging_ledger_worker') THEN
              CREATE ROLE piggyvest_staging_ledger_worker LOGIN;
            END IF;
          END $$;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO piggyvest_staging_ledger_worker;
          GRANT EXECUTE ON FUNCTION {SIGNATURE} TO piggyvest_staging_ledger_worker;
        """)
        self.assertEqual(apply(login='piggyvest_staging_ledger_worker'), 'deferred')
        self.assertEqual(self.sql(f"SELECT sum(posting.amount_kobo) FROM piggyvest_savings_ledger.postings posting "
                                 "JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id "
                                 f"WHERE operation.goal_id='{GOAL}' AND posting.account='principal'").strip(), '10000')
        self.assertEqual(self.sql(f"SELECT sum(posting.amount_kobo) FROM piggyvest_savings_ledger.postings posting "
                                 "JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id "
                                 f"WHERE operation.goal_id='{GOAL}' AND posting.account='paid_interest'").strip(), '900')
        self.assertEqual(self.sql(f"SELECT count(*) FROM savings_notifications.events "
                                 f"WHERE goal_id='{GOAL}' AND type='interest_credited'").strip(), '1')
        self.assertEqual(self.sql(f"SELECT authorized_login FROM piggyvest_savings_ledger.bindings "
                                 f"WHERE goal_id='{GOAL}'").strip(), 'prefunded_treasury_operator')
        for routine in ['apply', 'apply_bound']:
            self.assertEqual(self.sql(f"SELECT has_function_privilege('prefunded_treasury_operator',"
                                     f"'piggyvest_savings_ledger.{routine}(uuid,uuid,uuid,uuid,jsonb)',"
                                     "'EXECUTE')").strip(), 'f')
        self.sql(f"GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO unrelated_interest_worker; "
                 f"GRANT EXECUTE ON FUNCTION {SIGNATURE} TO unrelated_interest_worker")
        with self.assertRaises(subprocess.CalledProcessError):
            apply(login='unrelated_interest_worker')
        self.sql(f"UPDATE piggyvest_savings_ledger.bindings SET enabled=false WHERE goal_id='{GOAL}'")
        self.assertEqual(apply(), 'deferred')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(f"UPDATE piggyvest_savings_ledger.bindings SET authorized_login="
                     f"'piggyvest_staging_ledger_worker' WHERE goal_id='{GOAL}'")
        for login in ['anon', 'authenticated', 'service_role']:
            self.assertEqual(self.sql(f"SELECT has_function_privilege('{login}','{SIGNATURE}',"
                                     "'EXECUTE')").strip(), 'f')


if __name__ == '__main__':
    unittest.main()
