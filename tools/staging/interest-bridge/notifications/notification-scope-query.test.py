import json
from pathlib import Path
import sys
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT/'tools/test'))
from piggyvest_ledger_balance_harness import LedgerBalanceHarness


class ScopeQueryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = LedgerBalanceHarness()
        try:
            cls.host.sql("""
              CREATE SCHEMA savings_notifications;
              CREATE TABLE public.customers(id uuid,merchant_id uuid,user_id uuid,deleted_at timestamptz);
              CREATE TABLE public.customer_savings_goals(id uuid,merchant_id uuid,customer_id uuid,status text);
              CREATE TABLE public.push_tokens(token text,merchant_id uuid,user_id uuid,is_active boolean,app_type text);
              CREATE TABLE savings_notifications.events(id uuid,merchant_id uuid,customer_id uuid,goal_id uuid,
                event_key text,type text,title text,body text,due_period_start timestamptz,created_at timestamptz,
                read_at timestamptz,voided_at timestamptz,push_expanded_at timestamptz);
              CREATE TABLE savings_notifications.deliveries(notification_id uuid,push_token text,status text,
                claim_id uuid,claimed_at timestamptz,ticket_id text,receipt_error text);
              CREATE ROLE baci_savings_notifications_worker LOGIN NOINHERIT VALID UNTIL '2026-10-06T15:59:10Z';
              INSERT INTO public.push_tokens VALUES ('PRIVATE_TOKEN_FIXTURE',
                '10000000-0000-4000-8000-000000000001','baeb4f5a-54c7-4d46-8b07-9e69ab2907b3',true,'storefront');
              INSERT INTO savings_notifications.events VALUES ('ad00ea01-65f0-4594-b4f9-71cb609c6aaa',
                '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
                '9f01153c-1589-4dde-b9aa-8f644a846832','first-contribution','first_contribution',
                'PRIVATE_TITLE_FIXTURE','PRIVATE_BODY_FIXTURE',NULL,now(),NULL,NULL,NULL);
              INSERT INTO savings_notifications.deliveries VALUES ('ad00ea01-65f0-4594-b4f9-71cb609c6aaa',
                'PRIVATE_TOKEN_FIXTURE','accepted',gen_random_uuid(),now(),'PRIVATE_TICKET_FIXTURE',NULL);
            """)
        except Exception:
            cls.host.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.host.close()

    def collect(self):
        raw = (HERE/'notification-scope-query.sql').read_text()
        body = raw[raw.index('WITH goals AS MATERIALIZED'):]
        return self.host.sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL timezone='UTC'; "+body).stdout

    def test_actual_select_redacts_token_ticket_title_and_body(self):
        raw = self.collect()
        for secret in ('PRIVATE_TOKEN_FIXTURE', 'PRIVATE_TICKET_FIXTURE', 'PRIVATE_TITLE_FIXTURE', 'PRIVATE_BODY_FIXTURE'):
            self.assertNotIn(secret, raw)
        value = json.loads(raw)
        self.assertEqual(len(value['scope']['tokens']), 1)
        self.assertEqual(len(value['scope']['deliveries']), 1)
        self.assertEqual(len(value['scope']['deliveries'][0]['columnHashes']), 7)
        self.assertIsNone(value['scope']['events'][0]['actor'])

    def test_actual_hidden_body_mutation_changes_content_and_immutable_hash(self):
        before = json.loads(self.collect())['scope']['events'][0]
        self.host.sql("UPDATE savings_notifications.events SET body=body||'changed'")
        after = json.loads(self.collect())['scope']['events'][0]
        self.assertNotEqual(before['contentSha256'], after['contentSha256'])
        self.assertNotEqual(before['immutableSha256'], after['immutableSha256'])

    def test_production_identity_guard_refuses_disposable_cluster(self):
        result = self.host.sql((HERE/'notification-scope-query.sql').read_text(), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('notification_scope_identity_refused', result.stderr)


if __name__ == '__main__':
    unittest.main()
