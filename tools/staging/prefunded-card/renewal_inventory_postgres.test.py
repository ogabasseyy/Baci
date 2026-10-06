import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime


BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
SOURCE = Path(__file__).with_name('renewal-inventory.sql')
RECEIPT_SOURCE = SOURCE.with_name('renewal-receipt-inventory.sql')
INTEREST_SIGNATURES = (
    'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)',
    'public.get_customer_savings_earnings(uuid)',
    'savings_notifications.interest_recorded()',
)
RECEIPT_SIGNATURES = (
    'public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)',
    'public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)',
)


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 18 is unavailable')
class RenewalInventoryPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='baci-renewal-inventory.')
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
        cls.run_command([BIN / 'initdb', '-D', cls.root / 'data', '-A', 'trust', '-U', 'postgres', '--no-locale'])
        cls.run_command([BIN / 'pg_ctl', '-D', cls.root / 'data', '-l', cls.root / 'server.log',
                         '-o', f"-k {cls.root} -h '' -p 55478", 'start'])
        cls.addClassCleanup(cls.run_command, [BIN / 'pg_ctl', '-D', cls.root / 'data', '-m', 'immediate', 'stop'])
        cls.query("""
          CREATE SCHEMA prefunded_card;
          CREATE ROLE prefunded_evidence LOGIN VALID UNTIL '2026-09-29T15:59:10Z';
          CREATE ROLE supabase_admin LOGIN SUPERUSER;
          CREATE TABLE public.customer_savings_goals(id uuid,customer_id uuid,merchant_id uuid,current_amount numeric);
          INSERT INTO public.customer_savings_goals VALUES('430314fd-cd8b-4579-98d4-e9f345713dd6',
            '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',100);
          CREATE TABLE prefunded_card.treasury_bindings(id uuid,enabled boolean,verified_available_kobo bigint,
            reserved_kobo bigint,consumed_kobo bigint);
          INSERT INTO prefunded_card.treasury_bindings VALUES('ffffcb16-2e95-5cff-a591-e9cc81cf5f57',true,10000,0,0);
          CREATE TABLE prefunded_card.checkout_intents(id uuid,phase text,amount_kobo bigint,
            expires_at timestamptz CHECK(expires_at='2026-09-29T15:59:10Z'::timestamptz));
          INSERT INTO prefunded_card.checkout_intents VALUES('d8bcf921-61b3-4647-90e2-5648e4d6967d',
            'retired_unconfirmed',10000,'2026-09-29T15:59:10Z');
          CREATE TABLE prefunded_card.operations(id uuid,checkout_retired boolean,collection_status text,
            transfer_status text,projection_status text);
          INSERT INTO prefunded_card.operations VALUES('d8bcf921-61b3-4647-90e2-5648e4d6967d',
            true,'pending','not_started','unapplied');
          CREATE TABLE prefunded_card.checkout_retirements(id integer);
          INSERT INTO prefunded_card.checkout_retirements VALUES(1);
          CREATE TABLE prefunded_card.treasury_verifier_bindings(login_name name,expires_at timestamptz);
          CREATE FUNCTION prefunded_card.synthetic_deadline() RETURNS text LANGUAGE sql AS
            $$ SELECT '2026-09-29 never-print-this-synthetic-secret'::text $$;
        """)

    @classmethod
    def run_command(cls, arguments, **kwargs):
        return subprocess.run([str(value) for value in arguments], env=cls.environment, text=True,
                              capture_output=True, check=True, timeout=45, **kwargs)

    @classmethod
    def query(cls, sql, user='postgres', database='postgres'):
        return cls.run_command([BIN / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-h', cls.root,
                                '-p', '55478', '-U', user, '-d', database], input=sql).stdout.strip()

    def setUp(self):
        self.query("""
          DROP SCHEMA IF EXISTS piggyvest_savings_ledger CASCADE;
          DROP SCHEMA IF EXISTS savings_notifications CASCADE;
          DROP FUNCTION IF EXISTS public.get_customer_savings_earnings(uuid);
          DROP FUNCTION IF EXISTS public.get_customer_savings_earnings(text);
          DROP ROLE IF EXISTS piggyvest_staging_ledger_worker;
          DROP TABLE IF EXISTS public.piggyvest_staging_receipt_signatures;
          DROP FUNCTION IF EXISTS public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text);
          DROP FUNCTION IF EXISTS public.read_piggyvest_staging_receipt_signature(uuid,text,uuid);
          DROP FUNCTION IF EXISTS public.read_piggyvest_staging_receipt_signature(text);
        """)

    def scratch_source(self, source=SOURCE):
        identifier = self.query('SELECT system_identifier::text FROM pg_control_system();')
        pin = '7686901100561231906' if source == RECEIPT_SOURCE else '7685292944002592802'
        return source.read_text().replace(pin, identifier)

    def interest_fixture(self):
        self.query("""
          CREATE SCHEMA piggyvest_savings_ledger;
          CREATE SCHEMA savings_notifications;
          CREATE ROLE piggyvest_staging_ledger_worker LOGIN VALID UNTIL '2026-09-29T15:59:10Z';
          CREATE TABLE piggyvest_savings_ledger.interest_allocations(id uuid PRIMARY KEY,
            integration_id uuid,merchant_id uuid,customer_id uuid,goal_id uuid,enabled boolean,economics jsonb);
          CREATE TABLE piggyvest_savings_ledger.interest_receipts(allocation_id uuid PRIMARY KEY,
            first_event_id text,economics jsonb);
          INSERT INTO piggyvest_savings_ledger.interest_allocations
          SELECT ('00000000-0000-4000-8000-' || lpad(number::text,12,'0'))::uuid,
            CASE WHEN number=3 THEN '00000000-0000-4000-8000-000000000003'::uuid
              ELSE 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'::uuid END,
            CASE WHEN number=4 THEN '00000000-0000-4000-8000-000000000004'::uuid
              ELSE '10000000-0000-4000-8000-000000000001'::uuid END,
            CASE WHEN number=5 THEN '00000000-0000-4000-8000-000000000005'::uuid
              ELSE '10000000-0000-4000-8000-000000000002'::uuid END,
            CASE WHEN number=6 THEN '00000000-0000-4000-8000-000000000006'::uuid
              ELSE '430314fd-cd8b-4579-98d4-e9f345713dd6'::uuid END,
            number<>2, '{"private":"never-print-allocation-economics"}'::jsonb
          FROM generate_series(1,6) AS fixture(number);
          INSERT INTO piggyvest_savings_ledger.interest_receipts
            SELECT id,'never-print-event',economics FROM piggyvest_savings_ledger.interest_allocations;
          CREATE FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
            RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS
            $$ SELECT 'never-print-interest-body'::text $$;
          CREATE FUNCTION public.get_customer_savings_earnings(uuid) RETURNS jsonb LANGUAGE sql AS
            $$ SELECT '{"private":"never-print-earnings-body"}'::jsonb $$;
          CREATE FUNCTION public.get_customer_savings_earnings(text) RETURNS text LANGUAGE sql AS
            $$ SELECT 'never-print-overload'::text $$;
          CREATE FUNCTION savings_notifications.interest_recorded() RETURNS trigger LANGUAGE plpgsql AS
            $$ BEGIN RAISE EXCEPTION 'never-print-trigger-body'; END $$;
          REVOKE ALL ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text),
            public.get_customer_savings_earnings(uuid),savings_notifications.interest_recorded() FROM PUBLIC;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO piggyvest_staging_ledger_worker;
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)
            TO piggyvest_staging_ledger_worker;
        """)

    def interest_state(self):
        return self.query("""SELECT jsonb_build_object(
          'allocations',(SELECT jsonb_agg(to_jsonb(allocation) ORDER BY id)
            FROM piggyvest_savings_ledger.interest_allocations allocation),
          'receipts',(SELECT jsonb_agg(to_jsonb(receipt) ORDER BY allocation_id)
            FROM piggyvest_savings_ledger.interest_receipts receipt),
          'principal',(SELECT jsonb_agg(to_jsonb(goal)) FROM public.customer_savings_goals goal));""")

    def test_exact_query_refuses_other_database_and_projects_only_safe_metadata(self):
        source = SOURCE.read_text()
        with self.assertRaises(subprocess.CalledProcessError):
            self.query(source)
        identifier = self.query('SELECT system_identifier::text FROM pg_control_system();')
        scratch_source = source.replace('7685292944002592802', identifier)
        before = self.query('SELECT row_to_json(goal) FROM public.customer_savings_goals goal;')
        report = json.loads(self.query(scratch_source))
        self.assertTrue(report['readOnly'])
        self.assertEqual(report['principalKobo'], 10000)
        self.assertEqual(report['treasury']['reservedKobo'], 0)
        self.assertEqual(report['retirementAuditRows'], 1)
        self.assertTrue(report['operations'][0]['retired'])
        self.assertEqual(len(report['deadlineFunctions']), 1)
        self.assertEqual(len(report['deadlineConstraints']), 1)
        self.assertNotIn('never-print', json.dumps(report))
        self.assertEqual(before, self.query('SELECT row_to_json(goal) FROM public.customer_savings_goals goal;'))

    def test_absent_interest_schemas_tables_functions_and_worker_are_reported_without_failure(self):
        source = self.scratch_source()
        output = self.query(source + "\nSELECT coalesce(current_setting('baci.renewal_interest_inventory',true),'')='';")
        projected, reset = output.splitlines()
        report = json.loads(projected)['interestBridge']
        self.assertEqual(reset, 't')
        self.assertFalse(report['allocationsPresent'])
        self.assertFalse(report['receiptsPresent'])
        self.assertIsNone(report['allocationCount'])
        self.assertIsNone(report['enabledAllocationCount'])
        self.assertIsNone(report['receiptCount'])
        self.assertFalse(report['worker']['present'])
        self.assertEqual([item['signature'] for item in report['functions']], list(INTEREST_SIGNATURES))
        for item in report['functions']:
            self.assertFalse(item['present'])
            self.assertFalse(item['workerExecute'])
            self.assertIsNone(item['definitionSha256'])

    def test_interest_counts_are_exactly_scoped_and_only_function_hashes_are_returned(self):
        self.interest_fixture()
        before = self.interest_state()
        report = json.loads(self.query(self.scratch_source()))
        interest = report['interestBridge']
        self.assertEqual((interest['allocationCount'], interest['enabledAllocationCount'], interest['receiptCount']),
                         (2, 1, 2))
        self.assertTrue(interest['worker']['present'])
        self.assertTrue(interest['worker']['login'])
        self.assertTrue(interest['worker']['schemaUsage'])
        self.assertFalse(interest['worker']['superuser'])
        self.assertEqual(datetime.fromisoformat(interest['worker']['expiresAt']).timestamp(), 1790697550)
        self.assertEqual([item['workerExecute'] for item in interest['functions']], [True, False, False])
        for item in interest['functions']:
            self.assertTrue(item['present'])
            self.assertRegex(item['definitionSha256'], r'^[a-f0-9]{64}$')
            expected = self.query("SELECT encode(sha256(convert_to(pg_get_functiondef('" +
                                  item['signature'] + "'::regprocedure),'UTF8')),'hex');")
            self.assertEqual(item['definitionSha256'], expected)
        self.assertNotIn('never-print', json.dumps(report))
        self.assertEqual(self.interest_state(), before)

    def test_partial_interest_installation_does_not_require_missing_tables_or_worker(self):
        self.interest_fixture()
        self.query('DROP TABLE piggyvest_savings_ledger.interest_receipts;')
        report = json.loads(self.query(self.scratch_source()))['interestBridge']
        self.assertTrue(report['allocationsPresent'])
        self.assertFalse(report['receiptsPresent'])
        self.assertEqual(report['allocationCount'], 2)
        self.assertIsNone(report['receiptCount'])
        self.query('DROP TABLE piggyvest_savings_ledger.interest_allocations; '
                   'DROP OWNED BY piggyvest_staging_ledger_worker; DROP ROLE piggyvest_staging_ledger_worker;')
        report = json.loads(self.query(self.scratch_source()))['interestBridge']
        self.assertFalse(report['worker']['present'])
        self.assertTrue(all(item['present'] and not item['workerExecute'] for item in report['functions']))
        self.query('CREATE TABLE piggyvest_savings_ledger.interest_receipts(allocation_id uuid);')
        report = json.loads(self.query(self.scratch_source()))['interestBridge']
        self.assertFalse(report['allocationsPresent'])
        self.assertTrue(report['receiptsPresent'])
        self.assertIsNone(report['receiptCount'])

    def test_receipt_inventory_refuses_other_physical_database_user_and_database_name(self):
        source = RECEIPT_SOURCE.read_text()
        with self.assertRaises(subprocess.CalledProcessError):
            self.query(source, user='supabase_admin')
        for target, user in ((SOURCE, 'postgres'), (RECEIPT_SOURCE, 'supabase_admin')):
            source = self.scratch_source(target)
            with self.subTest(source=target.name), self.assertRaises(subprocess.CalledProcessError):
                self.query(source, user=user, database='template1')
            wrong_user = 'postgres' if user == 'supabase_admin' else 'supabase_admin'
            with self.assertRaises(subprocess.CalledProcessError):
                self.query(source, user=wrong_user)
            self.assertIn('inet_client_addr() IS NOT NULL', source)
            self.assertTrue(source.startswith('BEGIN READ ONLY;'))
            self.assertTrue(source.rstrip().endswith('ROLLBACK;'))

    def test_receipt_metadata_handles_absence_and_never_returns_signatures_or_payloads(self):
        source = self.scratch_source(RECEIPT_SOURCE)
        absent = json.loads(self.query(source, user='supabase_admin'))
        self.assertTrue(absent['readOnly'])
        self.assertFalse(absent['signatureTable']['present'])
        self.assertEqual(len(absent['functions']), 2)
        self.assertTrue(all(not item['present'] and item['definitionSha256'] is None for item in absent['functions']))
        self.query("""
          CREATE TABLE public.piggyvest_staging_receipt_signatures(receipt_id uuid,payload_sha256 text,
            provider_signature text,received_at timestamptz);
          INSERT INTO public.piggyvest_staging_receipt_signatures VALUES
            (gen_random_uuid(),'never-print-payload','never-print-signature',clock_timestamp());
          ALTER TABLE public.piggyvest_staging_receipt_signatures ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.piggyvest_staging_receipt_signatures FORCE ROW LEVEL SECURITY;
          CREATE FUNCTION public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)
            RETURNS text LANGUAGE sql AS $$ SELECT 'never-print-receipt-body'::text $$;
          CREATE FUNCTION public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)
            RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'never-print-signature-body'::text $$;
          CREATE FUNCTION public.read_piggyvest_staging_receipt_signature(text)
            RETURNS text LANGUAGE sql AS $$ SELECT 'never-print-other-overload'::text $$;
        """, user='supabase_admin')
        snapshot = 'SELECT row_to_json(receipt) FROM public.piggyvest_staging_receipt_signatures receipt;'
        before = self.query(snapshot, user='supabase_admin')
        report = json.loads(self.query(source, user='supabase_admin'))
        self.assertTrue(report['signatureTable']['present'])
        self.assertTrue(report['signatureTable']['rowSecurity'])
        self.assertTrue(report['signatureTable']['forceRowSecurity'])
        self.assertEqual(report['signatureTable']['owner'], 'supabase_admin')
        self.assertEqual([item['signature'] for item in report['functions']], list(RECEIPT_SIGNATURES))
        for item in report['functions']:
            self.assertTrue(item['present'])
            self.assertRegex(item['definitionSha256'], r'^[a-f0-9]{64}$')
            expected = self.query("SELECT encode(sha256(convert_to(pg_get_functiondef('" +
                                  item['signature'] + "'::regprocedure),'UTF8')),'hex');")
            self.assertEqual(item['definitionSha256'], expected)
        self.assertNotIn('never-print', json.dumps(report))
        self.assertEqual(self.query(snapshot, user='supabase_admin'), before)


if __name__ == '__main__':
    unittest.main()
