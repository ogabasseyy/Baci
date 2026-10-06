import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
INTEGRATION = '40000000-0000-4000-8000-000000000001'
MERCHANT = '10000000-0000-4000-8000-000000000001'
CUSTOMER = '20000000-0000-4000-8000-000000000001'
GOAL = '30000000-0000-4000-8000-000000000001'
USER = '50000000-0000-4000-8000-000000000001'
ECONOMICS = dict(payoutId='payout-1', providerCustomerId='provider-customer',
                 sourceWalletId='source', destinationWalletId='destination',
                 reference='reference', amountKobo=1000, grossKobo=1100,
                 taxKobo=100, netKobo=1000, currency='NGN')


class InterestDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='baci-interest-')
        cls.path = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items()
                           if not key.startswith('PG')}
        cls.shell([BIN / 'initdb', '-D', cls.path / 'data', '-A', 'trust',
                 '-U', 'harness_admin', '--no-locale', '--encoding=UTF8'])
        cls.start()
        cls.sql_file(ROOT / 'tools/test/piggyvest-savings-ledger-setup.sql')
        for migration in sorted((ROOT / 'supabase/migrations').glob('20260912120[0-5]00_*.sql')):
            cls.sql_file(migration)
        cls.sql(f"""
          CREATE SCHEMA auth;
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
            SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
          $$;
          ALTER TABLE public.customers ADD COLUMN user_id uuid, ADD COLUMN deleted_at timestamptz;
          UPDATE public.customers SET user_id='{USER}' WHERE id='{CUSTOMER}';
          CREATE TABLE public.customer_savings_contributions (
            id uuid PRIMARY KEY, goal_id uuid, merchant_id uuid, customer_id uuid,
            amount numeric, status text, processed_at timestamptz, created_at timestamptz
          );
        """)
        for migration in ['20260925130000_customer_savings_engagement_storage.sql',
                          '20260925130100_customer_savings_engagement_events.sql']:
            cls.sql_file(ROOT / 'supabase/migrations' / migration)
        migration = ROOT / 'supabase/migrations/20260926170000_piggyvest_interest_bridge.sql'
        if migration.exists():
            cls.sql_file(migration)
        cls.system_id = cls.sql('SELECT system_identifier FROM pg_control_system()').strip()

    @classmethod
    def shell(cls, args):
        return subprocess.run([str(value) for value in args], env=cls.environment,
                              text=True, capture_output=True, check=True)

    @classmethod
    def start(cls):
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-l', cls.path / 'log',
                 '-o', f"-k {cls.path} -h '' -p 55458", 'start'])

    @classmethod
    def sql(cls, query, user='harness_admin'):
        return cls.shell([BIN / 'psql', '-X', '-w', '-At', '-v', 'ON_ERROR_STOP=1',
                        '-h', cls.path, '-p', '55458', '-U', user, '-d', 'postgres', '-c', query]).stdout

    @classmethod
    def sql_file(cls, path):
        cls.shell([BIN / 'psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', cls.path,
                 '-p', '55458', '-U', 'harness_admin', '-d', 'postgres', '-f', path])

    @classmethod
    def tearDownClass(cls):
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-m', 'immediate', 'stop'])
        cls.directory.cleanup()


class InterestBridge(InterestDatabase):
    def test_bridge_atomic_replay_and_authority(self):
        signature = 'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)'
        self.assertEqual(self.sql(f"SELECT to_regprocedure('{signature}') IS NOT NULL").strip(), 't')
        self.sql(f"""
          CREATE ROLE piggyvest_staging_ledger_worker LOGIN;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO piggyvest_staging_ledger_worker;
          GRANT EXECUTE ON FUNCTION {signature} TO piggyvest_staging_ledger_worker;
          INSERT INTO piggyvest_savings_ledger.bindings VALUES
            ('{GOAL}','{INTEGRATION}','{MERCHANT}','{CUSTOMER}',
              'piggyvest_staging_ledger_worker',true);
          INSERT INTO piggyvest_savings_ledger.interest_allocations
            (integration_id,provider_business_id,payout_id,merchant_id,customer_id,goal_id,
             economics,customer_amount_kobo,eligibility_evidence,policy_reference,enabled)
          VALUES ('{INTEGRATION}','synthetic-account','payout-1','{MERCHANT}','{CUSTOMER}',
             '{GOAL}','{json.dumps(ECONOMICS)}',900,'synthetic-eligibility','synthetic-policy',true);
        """)
        def apply(economics=ECONOMICS, business='synthetic-account', pin=None, event_id='event-1'):
            return self.sql(f"SELECT piggyvest_savings_ledger.apply_interest_receipt('{INTEGRATION}',"
                            f"'{business}','{pin or self.system_id}','{json.dumps(economics)}','{event_id}')",
                            'piggyvest_staging_ledger_worker').strip()
        self.assertEqual(apply(business='wrong-business'), 'deferred')
        self.assertEqual(apply({**ECONOMICS, 'payoutId': 'missing'}), 'deferred')
        for field, value in [('providerCustomerId', 'wrong'), ('sourceWalletId', 'wrong'),
                             ('destinationWalletId', 'wrong'), ('amountKobo', 999),
                             ('taxKobo', 99), ('currency', 'USD')]:
            self.assertIn(apply({**ECONOMICS, field: value}), ['conflict', 'invalid'])
        with self.assertRaises(subprocess.CalledProcessError):
            apply(pin='1')
        self.sql('UPDATE piggyvest_savings_ledger.bindings SET enabled=false')
        self.assertEqual(apply(), 'deferred')
        self.sql('UPDATE piggyvest_savings_ledger.bindings SET enabled=true')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql('SELECT id FROM piggyvest_savings_ledger.interest_allocations',
                     'piggyvest_staging_ledger_worker')
        self.sql("""
          CREATE FUNCTION public.reject_interest_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic storage failure'; END $$;
          CREATE TRIGGER reject_interest_receipt BEFORE INSERT ON piggyvest_savings_ledger.interest_receipts
          FOR EACH ROW EXECUTE FUNCTION public.reject_interest_receipt();
        """)
        with self.assertRaises(subprocess.CalledProcessError):
            apply()
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations').strip(), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.postings').strip(), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM savings_notifications.events').strip(), '0')
        self.sql('DROP TRIGGER reject_interest_receipt ON piggyvest_savings_ledger.interest_receipts')
        self.sql(f"""
          INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000002');
          UPDATE public.customers SET merchant_id='10000000-0000-4000-8000-000000000002' WHERE id='{CUSTOMER}';
        """)
        self.assertEqual(apply(), 'conflict')
        self.sql(f"UPDATE public.customers SET merchant_id='{MERCHANT}' WHERE id='{CUSTOMER}'")
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda number: apply(event_id=f'event-{number}'), range(8)))
        self.assertEqual(results.count('applied'), 1)
        self.assertEqual(results.count('duplicate'), 7)
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='paid_interest'").strip(), '900')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations').strip(), '1')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts').strip(), '1')
        self.assertEqual(self.sql("SELECT amount_kobo FROM piggyvest_savings_ledger.postings WHERE account='internal_clearing'").strip(), '-900')
        self.shell([BIN / 'pg_ctl', '-D', self.path / 'data', '-m', 'fast', 'stop'])
        self.start()
        self.assertEqual(apply(event_id='after-restart'), 'duplicate')
        notifications = self.sql("SELECT count(*) FROM savings_notifications.events WHERE type='interest_credited'").strip()
        self.assertEqual(notifications, '1')
        self.assertEqual(self.sql("SELECT body LIKE '₦9.00 in confirmed%' FROM savings_notifications.events").strip(), 't')
        self.assertEqual(self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{USER}'; "
                                 f"SELECT public.get_customer_savings_earnings('{MERCHANT}')->>'credited_interest_kobo'; "
                                 "ROLLBACK;").splitlines()[-2], '900')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(f"BEGIN; SET ROLE authenticated; SET LOCAL request.jwt.claim.sub='{USER}'; "
                     "SELECT public.get_customer_savings_earnings('10000000-0000-4000-8000-000000000002'); ROLLBACK;")
        self.assertEqual(apply({**ECONOMICS, 'reference': 'changed'}), 'conflict')
        for role in ['anon', 'authenticated', 'service_role']:
            self.assertEqual(self.sql(f"SELECT has_function_privilege('{role}','{signature}','EXECUTE')").strip(), 'f')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql('DELETE FROM piggyvest_savings_ledger.interest_receipts')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql("UPDATE piggyvest_savings_ledger.interest_allocations SET customer_amount_kobo=1000")


if __name__ == '__main__':
    unittest.main()
