import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor


ROOT = Path(__file__).resolve().parents[2]
BIN = Path('/opt/homebrew/opt/postgresql@18/bin')
MERCHANT = '11111111-1111-4111-8111-111111111111'
CUSTOMER = '22222222-2222-4222-8222-222222222222'
GOAL = '33333333-3333-4333-8333-333333333333'
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
TREASURY = '50000000-0000-4000-8000-000000000001'
METHOD = '60000000-0000-4000-8000-000000000001'
OPERATION = '70000000-0000-4000-8000-000000000001'
WORKER = 'projection_worker'


class PrefundedProjection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='pvb-projection-')
        cls.path = Path(cls.directory.name)
        cls.environment = {key: value for key, value in os.environ.items()
                           if not key.startswith('PG')}
        cls.shell([BIN / 'initdb', '-D', cls.path / 'data', '-A', 'trust',
                   '-U', 'harness_admin', '--no-locale', '--encoding=UTF8'])
        cls.start()
        cls.file('tools/staging/piggyvest-goal-funding/projection.scratch-setup.sql')
        cls.sql(f"""
          CREATE ROLE {WORKER} LOGIN;
          CREATE ROLE prefunded_treasury_ledger_worker;
          CREATE ROLE prefunded_treasury_provisioner;
          CREATE ROLE prefunded_treasury_verifier;
          CREATE ROLE treasury_owner LOGIN;
          CREATE ROLE treasury_verifier LOGIN;
          GRANT prefunded_treasury_ledger_worker TO {WORKER};
          GRANT prefunded_treasury_provisioner TO treasury_owner;
          GRANT prefunded_treasury_verifier TO treasury_verifier;
          ALTER TABLE piggyvest_staging.integrations ADD COLUMN expected_provider_account_id text DEFAULT 'business';
          ALTER TABLE public.customer_savings_goals ADD COLUMN cancelled_at timestamptz, ADD COLUMN spent_at timestamptz;
          ALTER TABLE public.customer_savings_contributions ADD COLUMN created_at timestamptz DEFAULT now();
          ALTER TABLE public.piggyvest_inflow_credits ALTER COLUMN session_id DROP NOT NULL;
          CREATE TABLE public.customer_saved_payment_methods(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,
            provider text,reusable boolean,is_active boolean,disabled_at timestamptz);
          INSERT INTO public.customer_saved_payment_methods VALUES('{METHOD}','{MERCHANT}','{CUSTOMER}','paystack',true,true,NULL);
          UPDATE public.customer_savings_goals SET target_amount=200;
        """)
        for migration in sorted((ROOT / 'supabase/migrations').glob('20260912120[0-5]00_*.sql')):
            cls.file(migration)
        cls.file('tools/staging/piggyvest-goal-funding/projection-storage.sql')
        cls.file('tools/staging/piggyvest-goal-funding/projection-functions.sql')
        cls.file('tools/staging/prefunded-card/storage.sql')
        cls.file('tools/staging/prefunded-card/storage-functions.sql')
        cls.file('tools/staging/prefunded-card/treasury-storage.sql')
        cls.file('tools/staging/prefunded-card/treasury-functions.sql')
        for name in ['projection-storage.sql', 'projection-functions.sql', 'projection-inflow-guard.sql', 'projection-admission.sql']:
            cls.file(f'tools/staging/prefunded-card/{name}')
        cls.system = cls.sql('SELECT system_identifier FROM pg_control_system()').strip()

    @classmethod
    def shell(cls, arguments):
        try:
            return subprocess.run([str(value) for value in arguments], env=cls.environment,
                                  text=True, capture_output=True, check=True, timeout=60)
        except subprocess.CalledProcessError as error:
            error.add_note(error.stderr) if hasattr(error, 'add_note') else None
            if str(arguments[0]) in ['pnpm', 'node']:
                print(error.stderr)
                print(error.stdout)
            raise

    @classmethod
    def sql(cls, query, user='harness_admin'):
        return cls.shell([BIN / 'psql', '-X', '-w', '-At', '-v', 'ON_ERROR_STOP=1',
                          '-h', cls.path, '-p', '55461', '-U', user, '-d', 'postgres', '-c', query]).stdout.strip()

    @classmethod
    def file(cls, filename):
        cls.shell([BIN / 'psql', '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-h', cls.path,
                   '-p', '55461', '-U', 'harness_admin', '-d', 'postgres', '-f', ROOT / filename])

    @classmethod
    def start(cls):
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-l', cls.path / 'log',
                   '-o', f"-k {cls.path} -h '' -p 55461", 'start'])

    @classmethod
    def tearDownClass(cls):
        cls.shell([BIN / 'pg_ctl', '-D', cls.path / 'data', '-m', 'immediate', 'stop'])
        cls.directory.cleanup()

    def test_atomic_projection_and_old_worker_deduplication(self):
        self.assertEqual(self.sql("SELECT to_regprocedure('prefunded_card.project(uuid,text)') IS NOT NULL"), 't')
        self.sql(f"""
          INSERT INTO piggyvest_savings_ledger.bindings VALUES('{GOAL}','{INTEGRATION}','{MERCHANT}','{CUSTOMER}','{WORKER}',true);
          INSERT INTO prefunded_card.credit_routes VALUES('{GOAL}','{INTEGRATION}','{MERCHANT}',
            '{CUSTOMER}','{self.system}',now());
          GRANT USAGE ON SCHEMA prefunded_card TO {WORKER};
          GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA prefunded_card TO {WORKER};
          REVOKE EXECUTE ON FUNCTION prefunded_card.legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz) FROM {WORKER};
          GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz) TO {WORKER};
          GRANT USAGE ON SCHEMA prefunded_card TO treasury_owner,treasury_verifier;
          GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) TO treasury_owner;
          GRANT EXECUTE ON FUNCTION prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint) TO treasury_verifier;
        """)
        self.sql(f"SELECT prefunded_card.provision_treasury_identity('{TREASURY}','{INTEGRATION}','{MERCHANT}',"
                 f"'business','treasury-wallet','{WORKER}',50000)", 'treasury_owner')
        self.sql(f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}','opening',1,clock_timestamp(),50000)", 'treasury_verifier')
        command = dict(operationId=OPERATION, integrationId=INTEGRATION, merchantId=MERCHANT,
                       customerId=CUSTOMER, goalId=GOAL, treasuryBindingId=TREASURY,
                       requestFingerprint='fixture-fingerprint', idempotencyKey='fixture-idempotency',
                       savedMethodId=METHOD, amountKobo=10000, feeAllowanceKobo=0, currency='NGN',
                       collectionReference='collection-1', transferReference='transfer-1',
                       destinationWalletId='scratch-private-wallet', destinationCustomerId='scratch-event-customer')

        def execute(name, arguments, user=WORKER):
            return self.sql(f'SELECT prefunded_card.{name}({arguments})', user)

        other_goal = '33333333-3333-4333-8333-333333333334'
        self.sql(f"""
          INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,goal_kind,source_mode,current_amount,target_amount,status)
            VALUES('{other_goal}','{MERCHANT}','{CUSTOMER}','device','manual',0,200,'active');
          INSERT INTO piggyvest_savings_ledger.bindings VALUES('{other_goal}','{INTEGRATION}','{MERCHANT}','{CUSTOMER}','{WORKER}',true);
          INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES('{INTEGRATION}','unrouted-wallet','scratch-event-customer','{MERCHANT}','{CUSTOMER}','{other_goal}');
        """)
        unrouted = {**command, 'operationId': '70000000-0000-4000-8000-000000000009',
                    'goalId': other_goal, 'idempotencyKey': 'unrouted-operation',
                    'collectionReference': 'unrouted-charge', 'transferReference': 'unrouted-transfer',
                    'destinationWalletId': 'unrouted-wallet'}
        with self.assertRaises(subprocess.CalledProcessError) as denied_route:
            execute('reserve', f"'{json.dumps(unrouted)}'")
        self.assertIn('prefunded projection route refused', denied_route.exception.stderr)
        self.assertEqual(self.sql('SELECT reserved_kobo FROM prefunded_card.treasury_bindings'), '0')
        self.sql(f"UPDATE public.customer_savings_goals SET current_amount=1 WHERE id='{GOAL}'")
        with self.assertRaises(subprocess.CalledProcessError) as denied_principal:
            execute('reserve', f"'{json.dumps(command)}'")
        self.assertIn('prefunded admission requires reconciled principal', denied_principal.exception.stderr)
        self.sql(f"UPDATE public.customer_savings_goals SET current_amount=0 WHERE id='{GOAL}'")
        execute('reserve', f"'{json.dumps(command)}'")
        self.assertEqual(execute('project', f"'{OPERATION}','{self.system}'"), 'deferred')
        claim = json.loads(execute('claim_collection', f"'{OPERATION}',0"))
        self.assertEqual(claim['request']['sourceWalletId'], 'treasury-wallet')
        self.assertEqual(claim['request']['merchantId'], MERCHANT)
        collection = dict(reference='collection-1', amountKobo=10000, currency='NGN',
                          savedMethodId=METHOD, providerTransactionId='charge-1')
        execute('record_collection', f"'{OPERATION}',1,'verified_success','{json.dumps(collection)}'")
        execute('claim_transfer', f"'{OPERATION}',0")
        transfer = dict(reference='transfer-1', amountKobo=10000, currency='NGN',
                        businessId='business', sourceWalletId='treasury-wallet',
                        destinationWalletId='scratch-private-wallet', destinationCustomerId='scratch-event-customer',
                        providerTransactionId='transfer-tx-1')
        execute('record_transfer', f"'{OPERATION}',1,'verified_success','{json.dumps(transfer)}'")
        self.sql(f"UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id='{OPERATION}'")
        self.assertEqual(execute('project', f"'{OPERATION}','{self.system}'"), 'deferred')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.projections'), '0')
        self.sql(f"UPDATE prefunded_card.operations SET projection_status='unapplied' WHERE id='{OPERATION}'")
        with self.assertRaises(subprocess.CalledProcessError):
            execute('project', f"'{OPERATION}','1'")
        with self.assertRaises(subprocess.CalledProcessError):
            execute('project', f"'{OPERATION}','{self.system}'", 'harness_admin')
        self.sql("CREATE FUNCTION public.fail_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced insert failure'; END $$;"
                 "CREATE TRIGGER forced_failure BEFORE INSERT ON public.customer_savings_contributions FOR EACH ROW EXECUTE FUNCTION public.fail_projection()")
        with self.assertRaises(subprocess.CalledProcessError):
            execute('project', f"'{OPERATION}','{self.system}'")
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.projections'), '0')
        self.sql('DROP TRIGGER forced_failure ON public.customer_savings_contributions')
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: execute('project', f"'{OPERATION}','{self.system}'"), range(8)))
        self.assertEqual(results.count('applied'), 1)
        self.assertEqual(results.count('duplicate'), 7)
        self.assertEqual(self.sql('SELECT count(*) FROM public.customer_savings_contributions'), '1')

        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal'"), '10000')
        self.assertEqual(self.sql(f"SELECT current_amount FROM public.customer_savings_goals WHERE id='{GOAL}'"), '100.00')
        self.assertEqual(self.sql('SELECT projection_status FROM prefunded_card.operations'), 'applied')
        alias = {**transfer, 'providerTransactionId': 'inflow-tx-1'}
        self.assertEqual(execute('link_inflow', f"'{OPERATION}','{self.system}','{json.dumps(alias)}'"), 'linked')
        for reference, transaction, expected in [('transfer-1', 'inflow-tx-1', 'duplicate'),
                                                  ('transfer-1', 'unlinked', None), ('different-ref', 'inflow-tx-1', None)]:
            query = ("SELECT public.recognize_piggyvest_staging_inflow("
                     f"'{transaction}','data','new-event','scratch-event-customer','scratch-private-wallet',"
                     f"10000,0,'{reference}',NULL,now())")
            if expected:
                self.assertEqual(self.sql(query, WORKER), expected)
            else:
                with self.assertRaises(subprocess.CalledProcessError):
                    self.sql(query, WORKER)
        self.sql(f"GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz) TO pvb_staging_app_worker")
        self.assertEqual(self.sql("SELECT has_function_privilege('pvb_staging_app_worker',"
                                 "'prefunded_card.legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)','EXECUTE')"), 'f')
        with self.assertRaises(subprocess.CalledProcessError):
            self.sql(f"INSERT INTO public.customer_savings_contributions(goal_id,merchant_id,customer_id,amount,source_type,status,idempotency_key)"
                     f" VALUES('{GOAL}','{MERCHANT}','{CUSTOMER}',100,'wallet','completed','bypass')")
        next_command = {**command, 'operationId': '70000000-0000-4000-8000-000000000002',
                        'idempotencyKey': 'fixture-idempotency-2', 'collectionReference': 'collection-2', 'transferReference': 'transfer-2'}
        with self.assertRaises(subprocess.CalledProcessError):
            execute('reserve', f"'{json.dumps(next_command)}'")
        self.sql(f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}','post-transfer',2,clock_timestamp(),40000)", 'treasury_verifier')
        self.assertEqual(json.loads(execute('reserve', f"'{json.dumps(next_command)}'"))['outcome'], 'reserved')
        self.sql(f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}','unexpected-drift',3,clock_timestamp(),39900)", 'treasury_verifier')
        with self.assertRaises(subprocess.CalledProcessError):
            execute('claim_collection', "'70000000-0000-4000-8000-000000000002',0")
        self.assertEqual(self.sql("SELECT collection_status FROM prefunded_card.operations WHERE collection_reference='collection-2'"), 'not_started')
        self.sql(f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}','reconciled-drift',4,clock_timestamp(),40000)", 'treasury_verifier')
        self.shell([BIN / 'pg_ctl', '-D', self.path / 'data', '-l', self.path / 'log', '-m', 'fast', 'restart',
                    '-o', f"-k {self.path} -h '' -p 55461"])
        self.assertEqual(execute('project', f"'{OPERATION}','{self.system}'"), 'duplicate')
        self.assertEqual(self.sql('SELECT count(*) FROM public.customer_savings_contributions'), '1')

        stub = self.path / 'server-only.ts'
        stub.write_text('export {};\n')
        bundle = self.path / 'runtime.cjs'
        self.shell(['pnpm', '--dir', ROOT / 'apps/web', 'exec', 'esbuild',
                    ROOT / 'tools/test/prefunded-card-runtime-driver.ts', '--bundle', '--platform=node',
                    '--format=cjs', '--external:pg-native', '--tsconfig=' + str(ROOT / 'apps/web/tsconfig.json'),
                    '--alias:server-only=' + str(stub), '--outfile=' + str(bundle)])
        result = self.shell(['node', bundle, self.path, self.system])
        self.assertIn('REAL_RUNTIME_DISPOSABLE_DB_PASS', result.stdout)
        self.assertEqual(self.sql('SELECT count(*) FROM public.customer_savings_contributions'), '2')
        self.assertEqual(self.sql(f"SELECT current_amount FROM public.customer_savings_goals WHERE id='{GOAL}'"), '200.00')


if __name__ == '__main__':
    unittest.main()
