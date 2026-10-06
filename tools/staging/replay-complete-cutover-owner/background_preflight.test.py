import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import unittest


HERE = Path(__file__).resolve().parent
RECOVERY = HERE.parent / 'prefunded-card/checkout-recovery.sql'
SEALED = HERE.parent / 'prefunded-card/card-week-renewal/sealed-source.json'
RECOVERY_SHA = '75edc85b3f7b76f8501f7799696c017dff5b879f28a3d671d8e25a73b2c0a0d9'
SEALED_SHA = 'f947078b85964ce4dff797feec9cc08c09c1c85b689a5a95682c83c9869e7912'
BODY_SHA = 'f5266e9f873682afdaa2a7083ac6dbe0a636c383eea708489543cdc37ec2f1a5'
SIGNATURE = 'prefunded_card.checkout_recovery_candidates(jsonb,jsonb,integer)'
SYSTEM = '7685292944002592802'
DEADLINE = '2026-10-06T15:59:10Z'
OP = 'ff561046-58e7-428d-9163-f6e60b0dab65'
NEW = '9f01153c-1589-4dde-b9aa-8f644a846832'
OLD = '430314fd-cd8b-4579-98d4-e9f345713dd6'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
OTHER = '10000000-0000-4000-8000-000000000001'
SCOPE_ID = '10000000-0000-4000-8000-000000000002'
SPEC = importlib.util.spec_from_file_location('background_fixture', HERE.parent / 'replay-claim-fence/postgres.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class SourceTests(unittest.TestCase):
    def test_exact_renewed_recovery_predicate_and_body_are_pinned(self):
        self.assertEqual(hashlib.sha256(RECOVERY.read_bytes()).hexdigest(), RECOVERY_SHA)
        self.assertEqual(hashlib.sha256(SEALED.read_bytes()).hexdigest(), SEALED_SHA)
        source = RECOVERY.read_text()
        body = re.search(r'AS \$\$([\s\S]*?)\$\$;', source).group(1)
        self.assertEqual(hashlib.sha256(body.replace('2026-09-29T15:59:10Z', DEADLINE).encode()).hexdigest(), BODY_SHA)
        predicate = source[source.index("    WHERE stored.deployment"):source.index('    ORDER BY CASE')].rstrip()
        for key, column in (('integrationId', 'integration_id'), ('merchantId', 'merchant_id'),
                            ('treasuryBindingId', 'treasury_binding_id')):
            predicate = predicate.replace(f"(p_scope->>'{key}')::uuid", 'scope.' + column)
        for key, column in (('businessId', 'business_id'), ('systemIdentifier', 'system_identifier')):
            predicate = predicate.replace(f"p_scope->>'{key}'", 'scope.' + column)
        actual = (HERE / 'background_preflight.sql').read_text()
        self.assertIn(predicate.replace('2026-09-29T15:59:10Z', DEADLINE), actual)
        self.assertIn(BODY_SHA, actual)
        self.assertLess(len(actual.splitlines()), 300)
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', actual)
        self.assertTrue(actual.rstrip().endswith('ROLLBACK;'))


class BackgroundPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_type = FIXTURE.ClaimFencePostgresTests
        cls.fixture_type.setUpClass()
        cls.addClassCleanup(cls.fixture_type.tearDownClass)
        cls.fixture_type.command([FIXTURE.BIN / 'pg_ctl', '-D', cls.fixture_type.root / 'data',
            '-l', cls.fixture_type.root / 'log', '-o',
            f"-k {cls.fixture_type.root} -h '' -p 55479 -c max_prepared_transactions=10", '-w', 'restart'])

    def setUp(self):
        self.harness = self.fixture_type('runTest')
        self.harness.setUp()
        self.addCleanup(self.harness.doCleanups)
        self.sql = self.harness.sql
        self.sql("""CREATE SCHEMA prefunded_card;
CREATE TABLE prefunded_card.operations(id uuid PRIMARY KEY,integration_id uuid,merchant_id uuid,customer_id uuid,
 goal_id uuid,treasury_binding_id uuid,amount_kobo bigint,currency text,collection_status text,transfer_status text,
 projection_status text,transfer_attempted_at timestamptz,checkout_retired boolean,verification_token uuid,
 verification_lease_expires_at timestamptz,private_payload jsonb,transfer_provider_transaction_id text);
CREATE TABLE prefunded_card.checkout_intents(id uuid PRIMARY KEY,operation_id uuid,deployment text,integration_id uuid,
 merchant_id uuid,customer_id uuid,goal_id uuid,treasury_binding_id uuid,business_id text,system_identifier text,
 expires_at timestamptz,database_name name,authorized_login name,amount_kobo bigint,currency text,phase text,
 verified_collection jsonb,initialization_token uuid,initialization_lease_expires_at timestamptz,created_at timestamptz);
CREATE TABLE prefunded_card.dispatch_queue(operation_id uuid PRIMARY KEY,available_at timestamptz,claim_token uuid,
 lease_expires_at timestamptz,finished_at timestamptz,attempts bigint);
CREATE TABLE prefunded_card.treasury_bindings(id uuid PRIMARY KEY,integration_id uuid,merchant_id uuid,
 expected_business_id text,authorized_login name,currency text,verified_available_kobo bigint,reserved_kobo bigint,consumed_kobo bigint);
CREATE TABLE public.customer_savings_goals(id uuid PRIMARY KEY,current_amount numeric); CREATE TABLE public.prepared_probe(id integer);
CREATE FUNCTION prefunded_card.checkout_require_executor(text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION prefunded_card.checkout_validate_scope(jsonb,boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE FUNCTION prefunded_card.checkout_utc_iso(timestamptz) RETURNS text LANGUAGE sql AS
 $$ SELECT to_char($1 AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
CREATE FUNCTION prefunded_card.checkout_intent_json(prefunded_card.checkout_intents) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT jsonb_build_object('id',($1).id) $$;""")
        ddl = RECOVERY.read_text()[RECOVERY.read_text().index('CREATE FUNCTION'):RECOVERY.read_text().index('END $$;') + 7]
        self.sql(ddl.replace('2026-09-29T15:59:10Z', DEADLINE))
        self.system = self.sql('SELECT system_identifier::text FROM pg_control_system();').stdout.strip()
        self.sql(f"""INSERT INTO prefunded_card.treasury_bindings VALUES
 ('{TREASURY}','{SCOPE_ID}','{SCOPE_ID}','BUSINESS_fixture','prefunded_treasury_operator','NGN',10000,10000,0);
INSERT INTO prefunded_card.operations VALUES
 ('{OP}','{SCOPE_ID}','{SCOPE_ID}','{SCOPE_ID}','{NEW}','{TREASURY}',10000,'NGN','verified_success','dispatching','unapplied',now(),false,NULL,NULL,'{{"secret":"AUTH_fixture"}}',NULL),
 ('{OTHER}','{SCOPE_ID}','{SCOPE_ID}','{SCOPE_ID}','{OLD}','{TREASURY}',10000,'NGN','pending','not_started','unapplied',NULL,true,NULL,NULL,'{{"history":3}}',NULL);
INSERT INTO prefunded_card.checkout_intents VALUES
 ('{OP}','{OP}','staging','{SCOPE_ID}','{SCOPE_ID}','{SCOPE_ID}','{NEW}','{TREASURY}','BUSINESS_fixture','{self.system}',
 '{DEADLINE}',current_database(),'prefunded_treasury_operator',10000,'NGN','funding_pending','{{"authorizationCode":"AUTH_fixture"}}',NULL,NULL,now());
INSERT INTO prefunded_card.dispatch_queue VALUES ('{OP}',now()-interval '1 second',NULL,NULL,NULL,4),
 ('{OTHER}',now()-interval '1 day',NULL,NULL,now()-interval '1 day',3);
INSERT INTO public.customer_savings_goals VALUES ('{NEW}',0.0),('{OLD}',100.0);""")
        self.source = (HERE / 'background_preflight.sql').read_text().replace(SYSTEM, self.system).replace(
            "current_database() IS DISTINCT FROM 'postgres'", f"current_database() IS DISTINCT FROM '{self.harness.database}'")

    def collect(self, source=None):
        return json.loads(self.sql(source or self.source).stdout)

    def test_ready_decimal_principals_emit_integer_kobo_not_floats_or_native_authority(self):
        value = self.collect()
        self.assertEqual(value['blockers'], [])
        self.assertEqual(value['phase'], 'verify_existing_transfer')
        self.assertEqual(value['scope']['operationId'], OP)
        self.assertEqual(value['principalsKobo'], {'newGoal': 0, 'oldGoal': 10000})
        self.assertTrue(all(type(amount) is int for amount in value['principalsKobo'].values()))
        self.assertEqual(value['treasury'], {'budgetKobo': 10000, 'reservedKobo': 10000, 'consumedKobo': 0})
        self.assertTrue(value['identity']['readOnly'])
        self.assertEqual(value['recoveryRoutine']['bodySha256'], BODY_SHA)
        self.assertIs(type(value['recoveryRoutine']['oid']), int)
        self.assertTrue(all(count == 0 for count in value['drain'].values()))
        self.assertTrue(all(count == 0 for count in value['work'].values()))
        self.assertNotIn('AUTH_', json.dumps(value))
        self.assertNotIn('nativeEvidenceVerified', value)

    def test_sub_kobo_principals_are_null_and_blocked_never_rounded_or_truncated(self):
        for goal in (NEW, OLD):
            self.sql(f"UPDATE public.customer_savings_goals SET current_amount=current_amount+0.001 WHERE id='{goal}';")
            value = self.collect()
            self.assertIsNone(value['principalsKobo']['newGoal' if goal == NEW else 'oldGoal'])
            self.assertIn('principals', value['blockers'])

    def test_second_phase_accepts_only_exact_verified_transfer_and_uncredited_principal(self):
        exact = 'PVB01M3YP6SFJQTJQWE83SC5RMX1V'
        reset = f"UPDATE prefunded_card.operations SET transfer_status='verified_success',projection_status='unapplied',transfer_provider_transaction_id='{exact}' WHERE id='{OP}'; UPDATE prefunded_card.treasury_bindings SET reserved_kobo=0,consumed_kobo=10000 WHERE id='{TREASURY}'; UPDATE public.customer_savings_goals SET current_amount=0 WHERE id='{NEW}';"
        self.sql(reset)
        value = self.collect()
        self.assertEqual(value['phase'], 'apply_verified_projection')
        self.assertEqual(value['blockers'], [])
        self.assertTrue(all(type(amount) is int for amount in value['principalsKobo'].values()))
        self.assertEqual(value['target']['transferProviderTransactionId'], exact)
        self.assertEqual(value['treasury'], {'budgetKobo':10000,'reservedKobo':0,'consumedKobo':10000})
        cases = ((f"UPDATE prefunded_card.operations SET transfer_provider_transaction_id='foreign' WHERE id='{OP}';", 'target_state'),
            (f"UPDATE prefunded_card.operations SET transfer_provider_transaction_id=NULL WHERE id='{OP}';", 'target_state'),
            (f"UPDATE prefunded_card.operations SET transfer_status='dispatching' WHERE id='{OP}';", 'budget'),
            (f"UPDATE prefunded_card.treasury_bindings SET reserved_kobo=10000,consumed_kobo=0 WHERE id='{TREASURY}';", 'budget'),
            (f"UPDATE prefunded_card.treasury_bindings SET consumed_kobo=9999 WHERE id='{TREASURY}';", 'budget'),
            (f"UPDATE public.customer_savings_goals SET current_amount=100 WHERE id='{NEW}';", 'principals'),
            (f"UPDATE public.customer_savings_goals SET current_amount=101 WHERE id='{NEW}';", 'principals'),
            (f"UPDATE prefunded_card.operations SET projection_status='applied' WHERE id='{OP}';", 'target_state'))
        for statement, blocker in cases:
            self.sql(statement)
            self.assertIn(blocker, self.collect()['blockers'])
            self.sql(reset)

    def test_unresolved_target_leg_or_missing_attempt_or_retirement_blocks(self):
        for change in ("collection_status='not_started'", "transfer_status='not_started'",
                       "transfer_attempted_at=NULL", "projection_status='applied'", 'checkout_retired=true'):
            with self.subTest(change=change):
                self.sql(f"UPDATE prefunded_card.operations SET {change} WHERE id='{OP}';")
                self.assertIn('target_state', self.collect()['blockers'])
                self.sql("UPDATE prefunded_card.operations SET collection_status='verified_success',"
                         "transfer_status='dispatching',transfer_attempted_at=now(),projection_status='unapplied',"
                         f"checkout_retired=false WHERE id='{OP}';")

    def test_queue_future_finished_or_active_lease_blocks_without_changing_it(self):
        for change in ("available_at=now()+interval '1 minute'", 'finished_at=now()',
                       f"claim_token='{OTHER}',lease_expires_at=now()+interval '1 minute'"):
            self.sql(f"UPDATE prefunded_card.dispatch_queue SET {change} WHERE operation_id='{OP}';")
            self.assertIn('target_queue', self.collect()['blockers'])
            self.sql(f"UPDATE prefunded_card.dispatch_queue SET available_at=now()-interval '1 second',"
                     f"finished_at=NULL,claim_token=NULL,lease_expires_at=NULL WHERE operation_id='{OP}';")

    def test_global_active_and_malformed_leases_block_even_on_retired_history(self):
        for table, token, expiry, key, active, malformed in (
            ('operations', 'verification_token', 'verification_lease_expires_at', 'id', 'activeVerificationLeases', 'malformedVerificationPairs'),
            ('checkout_intents', 'initialization_token', 'initialization_lease_expires_at', 'id', 'activeInitializationLeases', 'malformedInitializationPairs'),
            ('dispatch_queue', 'claim_token', 'lease_expires_at', 'operation_id', 'activeDispatchLeases', 'malformedDispatchPairs')):
            selected = OP if table == 'checkout_intents' else OTHER
            self.sql(f"UPDATE prefunded_card.{table} SET {token}='{OTHER}',{expiry}=now()+interval '1 minute' WHERE {key}='{selected}';")
            self.assertEqual(self.collect()['drain'][active], 1)
            self.assertTrue(self.collect()['blockers'])
            self.sql(f"UPDATE prefunded_card.{table} SET {expiry}=NULL WHERE {key}='{selected}';")
            self.assertEqual(self.collect()['drain'][malformed], 1)
            self.sql(f"UPDATE prefunded_card.{table} SET {token}=NULL,{expiry}=NULL WHERE {key}='{selected}';")

    def test_intact_expired_pairs_block_and_are_never_reset(self):
        for kind, table, token, expiry, key in (('Verification','operations','verification_token','verification_lease_expires_at','id'),
            ('Initialization','checkout_intents','initialization_token','initialization_lease_expires_at','id'),
            ('Dispatch','dispatch_queue','claim_token','lease_expires_at','operation_id')):
            self.sql(f"UPDATE prefunded_card.{table} SET {token}='{OTHER}',{expiry}=now()-interval '1 minute' WHERE {key}='{OP}';")
            value = self.collect()
            self.assertEqual(value['drain']['active' + kind + 'Leases'], 0)
            self.assertEqual(value['drain']['expired' + kind + 'Pairs'], 1)
            self.assertIn(kind.lower() + '_leases', value['blockers'])
            if kind == 'Dispatch':
                self.assertIn('target_queue', value['blockers'])
            self.assertEqual(self.sql(f"SELECT {token} FROM prefunded_card.{table} WHERE {key}='{OP}';").stdout.strip(), OTHER)
            self.sql(f"UPDATE prefunded_card.{table} SET {token}=NULL,{expiry}=NULL WHERE {key}='{OP}';")

    def test_missing_target_rows_fail_closed(self):
        for table, key, blocker in (('checkout_intents','operation_id','target_checkout'),
            ('dispatch_queue','operation_id','target_queue'),('operations','id','target_state'),
            ('treasury_bindings','id','budget')):
            selected = TREASURY if table == 'treasury_bindings' else OP
            self.sql(f"DELETE FROM prefunded_card.{table} WHERE {key}='{selected}';")
            self.assertIn(blocker, self.collect()['blockers'])

    def test_foreign_checkout_scope_cannot_pass_as_target(self):
        self.sql(f"UPDATE prefunded_card.checkout_intents SET merchant_id='{OTHER}' WHERE operation_id='{OP}';")
        self.assertIn('target_checkout', self.collect()['blockers'])

    def test_other_nonretired_unfinished_operation_blocks_even_without_queue_or_checkout(self):
        self.sql(f"DELETE FROM prefunded_card.dispatch_queue WHERE operation_id='{OTHER}'; "
                 f"UPDATE prefunded_card.operations SET checkout_retired=false WHERE id='{OTHER}';")
        self.assertEqual(self.collect()['work']['otherNonretiredUnfinishedOperations'], 1)
        self.assertIn('other_operations', self.collect()['blockers'])

    def test_applied_operation_with_unfinished_queue_still_blocks(self):
        self.sql(f"UPDATE prefunded_card.operations SET checkout_retired=false,projection_status='applied' WHERE id='{OTHER}'; "
                 f"UPDATE prefunded_card.dispatch_queue SET finished_at=NULL WHERE operation_id='{OTHER}';")
        self.assertIn('other_operations', self.collect()['blockers'])

    def test_budget_principals_and_checkout_conditions_block(self):
        for statement, blocker in ((f"UPDATE prefunded_card.treasury_bindings SET reserved_kobo=9999 WHERE id='{TREASURY}';", 'budget'),
            (f"UPDATE public.customer_savings_goals SET current_amount=101 WHERE id='{OLD}';", 'principals'),
            (f"UPDATE prefunded_card.checkout_intents SET verified_collection=NULL WHERE id='{OP}';", 'target_checkout')):
            self.sql(statement)
            self.assertIn(blocker, self.collect()['blockers'])

    def test_scoped_count_matches_actual_renewed_recovery_function_predicate(self):
        for phase in ('initializing', 'ready', 'pending'):
            self.sql(f"UPDATE prefunded_card.checkout_intents SET phase='{phase}' WHERE id='{OP}';")
            value = self.collect()
            self.assertEqual(value['work']['scopedRecoveryCandidates'], 1)
            self.assertIn('recovery_candidates', value['blockers'])
        scope = json.dumps(dict(integrationId=SCOPE_ID, merchantId=SCOPE_ID, treasuryBindingId=TREASURY,
                                businessId='BUSINESS_fixture', systemIdentifier=self.system))
        actual = json.loads(self.sql(f"SELECT {SIGNATURE.split('(')[0]}('{scope}'::jsonb,NULL,20);").stdout)
        self.assertEqual(len(actual['candidates']), self.collect()['work']['scopedRecoveryCandidates'])
        self.sql(f"UPDATE prefunded_card.checkout_intents SET expires_at='2026-09-29T15:59:10Z' WHERE id='{OP}';")
        value = self.collect()
        actual = json.loads(self.sql(f"SELECT {SIGNATURE.split('(')[0]}('{scope}'::jsonb,NULL,20);").stdout)
        self.assertEqual(value['work']['scopedRecoveryCandidates'], len(actual['candidates']))
        self.assertEqual(value['work']['scopedRecoveryCandidates'], 0)
        self.assertEqual(value['work']['recoveryPhaseIntents'], 1)

    def test_recovery_routine_drift_or_absence_blocks(self):
        self.sql("CREATE OR REPLACE FUNCTION prefunded_card.checkout_recovery_candidates(p_scope jsonb,p_after jsonb,p_limit integer) "
                 "RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;")
        self.assertIn('recovery_routine', self.collect()['blockers'])
        self.sql(f'DROP FUNCTION {SIGNATURE};')
        self.assertIn('recovery_routine', self.collect()['blockers'])

    def test_prepared_transaction_blocks_and_is_only_rolled_back_by_test_cleanup(self):
        self.sql("BEGIN; INSERT INTO public.prepared_probe VALUES(1); PREPARE TRANSACTION 'background_fixture';")
        self.addCleanup(self.sql, "ROLLBACK PREPARED 'background_fixture';")
        self.assertEqual(self.collect()['drain']['preparedTransactions'], 1)
        self.assertIn('prepared_transactions', self.collect()['blockers'])

    def test_other_idle_client_transaction_blocks_without_emitting_query_or_pid(self):
        arguments = [FIXTURE.BIN / 'psql', '-XqAt', '-w', '-h', self.harness.root,
                     '-p', '55479', '-U', 'postgres', '-d', self.harness.database]
        process = subprocess.Popen(list(map(str, arguments)), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=self.harness.environment)
        self.addCleanup(lambda: process.communicate('ROLLBACK;\n\\q\n', timeout=10))
        process.stdin.write('BEGIN; SELECT pg_backend_pid();\n')
        process.stdin.flush()
        pid = process.stdout.readline().strip()
        value = self.collect()
        self.assertEqual(value['drain']['otherClientTransactions'], 1)
        self.assertIn('client_transactions', value['blockers'])
        self.assertNotIn(pid, json.dumps(value['drain']))

    def test_wrong_database_physical_role_replication_or_expiry_refuses(self):
        sources = ((HERE / 'background_preflight.sql').read_text(),
            (HERE / 'background_preflight.sql').read_text().replace(SYSTEM, self.system),
            self.source.replace(DEADLINE, '2000-01-01T00:00:00Z'),
            self.source.replace('DO $background_identity$', 'SET LOCAL ROLE pg_read_all_data; DO $background_identity$', 1),
            self.source.replace('DO $background_identity$', "SET LOCAL session_replication_role='replica'; DO $background_identity$", 1))
        for source in sources:
            result = self.sql(source, checked=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, '')
            self.assertIn('background_preflight_identity_refused', result.stderr)

    def test_read_only_collector_preserves_all_rows_routines_and_retired_history(self):
        tables = ('prefunded_card.operations','prefunded_card.checkout_intents','prefunded_card.dispatch_queue',
                  'prefunded_card.treasury_bindings','public.customer_savings_goals')
        members = [f"'{table}',(SELECT jsonb_agg(to_jsonb(source) ORDER BY to_jsonb(source)::text) FROM {table} source)"
                   for table in tables]
        members.append(f"'routine',(SELECT to_jsonb(source) FROM pg_proc source WHERE oid='{SIGNATURE}'::regprocedure)")
        snapshot = 'SELECT jsonb_build_object(' + ','.join(members) + ');'
        before = self.sql(snapshot).stdout
        self.collect()
        self.assertEqual(self.sql(snapshot).stdout, before)
        result = self.sql(self.source.replace('DO $background_identity$',
            'DELETE FROM prefunded_card.operations; DO $background_identity$', 1), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('read-only transaction', result.stderr)

if __name__ == '__main__':
    unittest.main()
