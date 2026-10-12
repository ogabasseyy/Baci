import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
BASELINE = HERE.parent / 'prefunded-card/checkout-claim-boundary/snapshot.sql'
BASELINE_SHA = '680b3b7d0c5d49eb24f2f898356cbc6c5bd90916c511a90fda8faa5ea2fc8d79'
SYSTEM = '7685292944002592802'
DEADLINE = '2026-10-06T15:59:10Z'
OP = 'ff561046-58e7-428d-9163-f6e60b0dab65'
NEW = '9f01153c-1589-4dde-b9aa-8f644a846832'
OLD = '430314fd-cd8b-4579-98d4-e9f345713dd6'
TREASURY = 'ffffcb16-2e95-5cff-a591-e9cc81cf5f57'
OTHER = '10000000-0000-4000-8000-000000000001'
SIGNATURES = ('prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)',
              'prefunded_card.claim_reconciliation(uuid,integer)')
TABLES = {
    'prefunded_card.operations': 'id uuid, goal_id uuid, amount_kobo bigint, verification_token uuid',
    'prefunded_card.checkout_intents': 'operation_id uuid, phase text, verified_collection jsonb, session_authorization_url text',
    'prefunded_card.dispatch_queue': 'operation_id uuid, attempts bigint, claim_token uuid',
    'prefunded_card.projections': 'operation_id uuid, amount_kobo bigint',
    'prefunded_card.provider_aliases': 'operation_id uuid, provider_transaction_id text',
    'piggyvest_savings_ledger.operations': 'id uuid, goal_id uuid, command jsonb',
    'piggyvest_savings_ledger.postings': 'operation_id uuid, account text, amount_kobo bigint',
    'public.customer_savings_contributions': 'goal_id uuid, idempotency_key text, amount numeric, metadata jsonb',
    'public.customer_savings_goals': 'id uuid, current_amount numeric, metadata jsonb',
    'savings_notifications.events': 'id uuid, goal_id uuid, type text, body text',
    'savings_notifications.deliveries': 'notification_id uuid, status text, push_token text, claim_id uuid',
    'prefunded_card.treasury_bindings': 'id uuid, verified_available_kobo bigint, reserved_kobo bigint, consumed_kobo bigint',
}
MVS = ('customer_insights', 'daily_sales_summary', 'merchant_health', 'platform_daily_summary',
       'platform_growth', 'product_performance', 'sales_by_channel', 'top_merchants')
SPEC = importlib.util.spec_from_file_location('financial_snapshot_fixture',
                                            HERE.parent / 'replay-claim-fence/postgres.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class SourceTests(unittest.TestCase):
    def test_embedded_select_is_exact_pinned_baseline_without_inventory_edits(self):
        baseline = BASELINE.read_bytes()
        self.assertEqual(hashlib.sha256(baseline).hexdigest(), BASELINE_SHA)
        source = (HERE / 'financial_snapshot.sql').read_text()
        self.assertIn(baseline.decode().rstrip().removesuffix(';'), source)
        self.assertLessEqual(len(source.splitlines()), 300)
        self.assertEqual(source.count(SYSTEM), 1)
        self.assertEqual(source.count(DEADLINE), 2)
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', source)
        self.assertTrue(source.rstrip().endswith('ROLLBACK;'))
        self.assertNotIn('COMMIT;', source)


class FinancialSnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_type = FIXTURE.ClaimFencePostgresTests
        cls.fixture_type.setUpClass()
        cls.addClassCleanup(cls.fixture_type.tearDownClass)

    def setUp(self):
        self.harness = self.fixture_type('runTest')
        self.harness.setUp()
        self.addCleanup(self.harness.doCleanups)
        self.sql = self.harness.sql
        self.sql('CREATE SCHEMA prefunded_card; CREATE SCHEMA piggyvest_savings_ledger; '
                 'CREATE SCHEMA savings_notifications; ' + ''.join(
                     f'CREATE TABLE {name} ({columns});' for name, columns in TABLES.items()))
        self.sql(''.join(f"CREATE FUNCTION {signature} RETURNS jsonb LANGUAGE plpgsql "
                        "SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN '[]'::jsonb; END $$;"
                        for signature in SIGNATURES))
        self.sql('CREATE TABLE public.protected_secret (id integer, secret text); '
                 "INSERT INTO public.protected_secret VALUES (1,'AUTH_HIDDEN_FIXTURE'); "
                 'CREATE SEQUENCE public.protected_sequence; '
                 'CREATE FUNCTION public.protected_routine() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;')
        self.sql(''.join(f'CREATE MATERIALIZED VIEW public.{name} AS '
                        f'SELECT id,secret FROM public.protected_secret '
                        + ('WITH NO DATA;' if name == 'top_merchants' else
                           'WHERE false;' if name == 'daily_sales_summary' else ';') for name in MVS))
        self.sql(f"""
INSERT INTO prefunded_card.operations VALUES ('{OP}','{NEW}',10000,'{OTHER}'),('{OTHER}','{OLD}',10000,NULL);
INSERT INTO prefunded_card.checkout_intents VALUES ('{OP}','funding_pending',
 '{{"authorization":{{"authorizationCode":"AUTH_PRIVATE_FIXTURE"}}}}','https://checkout.paystack.com/PRIVATE_FIXTURE');
INSERT INTO prefunded_card.dispatch_queue VALUES ('{OP}',1,'{OTHER}'),('{OTHER}',2,NULL),(NULL,3,NULL);
INSERT INTO prefunded_card.projections VALUES ('{OP}',10000),('{OTHER}',10000);
INSERT INTO prefunded_card.provider_aliases VALUES ('{OP}','provider<&fixture'),('{OTHER}','other');
INSERT INTO piggyvest_savings_ledger.operations VALUES ('{OP}','{NEW}','{{"private":"AUTH_LEDGER_FIXTURE"}}');
INSERT INTO piggyvest_savings_ledger.postings VALUES ('{OP}','principal',10000),('{OP}','internal_clearing',-10000),('{OTHER}','principal',10000);
INSERT INTO public.customer_savings_contributions VALUES ('{NEW}','pvb-card:{OP}',100,'{{"private":"AUTH_CONTRIBUTION_FIXTURE"}}'),
 ('{OLD}','pvb-card:{OP}',100,'{{}}'),('{NEW}','other',200,'{{}}'),(NULL,'pvb-card:{OP}',300,'{{}}'),('{NEW}',NULL,400,'{{}}');
INSERT INTO public.customer_savings_goals VALUES ('{NEW}',100,'{{}}'),('{OLD}',100,'{{}}');
INSERT INTO savings_notifications.events VALUES ('{OP}','{NEW}','first_contribution','AUTH_BODY_FIXTURE'),
 ('{TREASURY}','{NEW}','milestone','AUTH_BODY_FIXTURE'),('{OTHER}','{OLD}','milestone','old');
INSERT INTO savings_notifications.deliveries VALUES ('{OP}','pending','PUSH_PRIVATE_FIXTURE','{OTHER}'),
 ('{TREASURY}','pending','PUSH_SECOND_FIXTURE',NULL),('{OTHER}','accepted','PUSH_OLD_FIXTURE',NULL),(NULL,'pending','PUSH_NULL_FIXTURE',NULL);
INSERT INTO prefunded_card.treasury_bindings VALUES ('{TREASURY}',10000,10000,0),('{OTHER}',20000,0,0);
""")
        self.system = self.sql('SELECT system_identifier::text FROM pg_control_system();').stdout.strip()
        self.source = (HERE / 'financial_snapshot.sql').read_text().replace(SYSTEM, self.system)
        self.source = self.source.replace("current_database() IS DISTINCT FROM 'postgres'",
                                          f"current_database() IS DISTINCT FROM '{self.harness.database}'")

    def snapshot(self, source=None):
        return json.loads(self.sql(source or self.source).stdout)

    def witness(self, evidence, name):
        return evidence['allowedTargetWitnesses'][name]

    def test_full_snapshot_matches_baseline_including_eight_materialized_views_and_sequences(self):
        baseline = json.loads(self.sql(BASELINE.read_text().replace('__CLOSURE__', BASELINE_SHA)).stdout)
        evidence = self.snapshot()
        self.assertIs(evidence['readOnly'], True)
        self.assertNotIn('readOnly', evidence['identity'])
        for key in ('identity', 'functions', 'tableRows', 'unsupportedRelations', 'permanentMetadataSha256'):
            self.assertEqual(evidence[key], baseline[key], key)
        self.assertEqual(evidence['baselineSnapshotSha256'], BASELINE_SHA)
        self.assertEqual(evidence['scope'], dict(operationId=OP, newGoalId=NEW, oldGoalId=OLD,
                                               treasuryBindingId=TREASURY, idempotencyKey='pvb-card:' + OP))
        self.assertEqual(set(evidence['allowedTargetWitnesses']), set(TABLES))
        self.assertTrue(all('public.' + name in evidence['tableRows'] for name in MVS))
        populated = evidence['tableRows']['public.customer_insights']
        unpopulated = evidence['tableRows']['public.top_merchants']
        self.assertTrue(populated['populated'])
        self.assertEqual(populated['count'], 1)
        self.assertFalse(unpopulated['populated'])
        self.assertEqual(unpopulated['count'], 0)
        self.assertNotEqual(unpopulated['sha256'], evidence['tableRows']['public.daily_sales_summary']['sha256'])
        self.assertIn('public.protected_sequence', evidence['tableRows'])

    def test_witness_counts_use_exact_ids_conjunction_and_notification_join(self):
        evidence = self.snapshot()
        for name in TABLES:
            count = 2 if name in ('piggyvest_savings_ledger.postings', 'savings_notifications.events',
                                 'savings_notifications.deliveries') else 1
            row = self.witness(evidence, name)
            self.assertEqual(row['targetCount'], count, name)
            self.assertEqual(len(row['targetRows']), count)
            self.assertEqual(len(row['targetRowColumnHashes']), count)
            self.assertEqual(row['targetCount'] + row['excludedTargetCount'], evidence['tableRows'][name]['count'])
            for key in ('targetHash', 'excludedTargetHash'):
                self.assertRegex(row[key], r'^[0-9a-f]{64}$')
        self.assertEqual(self.witness(evidence, 'public.customer_savings_contributions')['excludedTargetCount'], 4)
        self.assertEqual(self.witness(evidence, 'savings_notifications.deliveries')['excludedTargetCount'], 2)
        alias = self.witness(evidence, 'prefunded_card.provider_aliases')['targetRows'][0]
        self.assertEqual(alias['provider_transaction_id'], 'provider<&fixture')

    def test_target_change_changes_full_and_target_hash_but_not_exclusion_witness(self):
        before = self.snapshot()
        self.sql(f"UPDATE prefunded_card.operations SET amount_kobo=10001 WHERE id='{OP}';")
        after = self.snapshot()
        name = 'prefunded_card.operations'
        self.assertNotEqual(before['tableRows'][name]['sha256'], after['tableRows'][name]['sha256'])
        self.assertNotEqual(self.witness(before, name)['targetHash'], self.witness(after, name)['targetHash'])
        self.assertEqual(self.witness(before, name)['excludedTargetHash'], self.witness(after, name)['excludedTargetHash'])
        self.assertEqual(self.witness(after, name)['targetRows'][0]['amount_kobo'], 10001)

    def test_old_goal_and_wrong_goal_same_idempotency_key_remain_protected(self):
        before = self.snapshot()
        self.sql(f"UPDATE public.customer_savings_goals SET current_amount=101 WHERE id='{OLD}'; "
                 f"UPDATE public.customer_savings_contributions SET amount=101 WHERE goal_id='{OLD}';")
        after = self.snapshot()
        for name in ('public.customer_savings_goals', 'public.customer_savings_contributions'):
            self.assertNotEqual(before['tableRows'][name]['sha256'], after['tableRows'][name]['sha256'])
            self.assertNotEqual(self.witness(before, name)['excludedTargetHash'], self.witness(after, name)['excludedTargetHash'])
            self.assertEqual(self.witness(before, name)['targetHash'], self.witness(after, name)['targetHash'])

    def test_null_predicates_are_protected_not_lost_to_sql_three_valued_logic(self):
        before = self.snapshot()
        self.sql('UPDATE prefunded_card.dispatch_queue SET attempts=4 WHERE operation_id IS NULL; '
                 'UPDATE public.customer_savings_contributions SET amount=401 WHERE idempotency_key IS NULL;')
        after = self.snapshot()
        for name in ('prefunded_card.dispatch_queue', 'public.customer_savings_contributions'):
            self.assertNotEqual(self.witness(before, name)['excludedTargetHash'], self.witness(after, name)['excludedTargetHash'])
            self.assertEqual(self.witness(before, name)['targetHash'], self.witness(after, name)['targetHash'])

    def test_no_plaintext_credentials_and_unknown_columns_are_hashed_not_emitted(self):
        self.sql('ALTER TABLE prefunded_card.operations ADD COLUMN future_private text; '
                 f"UPDATE prefunded_card.operations SET future_private='AUTH_FUTURE_FIXTURE' WHERE id='{OP}';")
        before = self.snapshot()
        rendered = json.dumps(before)
        for value in ('AUTH_', 'PUSH_', 'PRIVATE_FIXTURE', 'FUTURE_FIXTURE'):
            self.assertNotIn(value, rendered)
        name = 'prefunded_card.operations'
        self.assertIn('future_private', self.witness(before, name)['redactedColumns'])
        self.assertNotIn('verification_token', self.witness(before, name)['targetRows'][0])
        columns = self.witness(before, name)['targetRowColumnHashes'][0]
        self.assertEqual(set(columns), {'id', 'goal_id', 'amount_kobo', 'verification_token', 'future_private'})
        self.assertEqual(columns['verification_token'], hashlib.sha256(('"' + OTHER + '"').encode()).hexdigest())
        self.sql(f"UPDATE prefunded_card.operations SET future_private='AUTH_CHANGED_FIXTURE' WHERE id='{OP}';")
        after = self.snapshot()
        self.assertNotEqual(self.witness(before, name)['targetHash'], self.witness(after, name)['targetHash'])
        self.assertEqual(self.witness(before, name)['targetRows'], self.witness(after, name)['targetRows'])
        self.assertNotEqual(columns['future_private'],
                            self.witness(after, name)['targetRowColumnHashes'][0]['future_private'])

    def test_sequences_unallowed_rows_and_permanent_metadata_are_not_waived(self):
        before = self.snapshot()
        self.sql("SELECT nextval('public.protected_sequence'); UPDATE public.protected_secret SET secret='AUTH_CHANGED'; "
                 'ALTER TABLE public.protected_secret SET (fillfactor=90);')
        after = self.snapshot()
        for name in ('public.protected_sequence', 'public.protected_secret'):
            self.assertNotEqual(before['tableRows'][name]['sha256'], after['tableRows'][name]['sha256'])
        self.assertNotEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])

    def test_original_body_exclusion_retained_but_other_routine_changes_are_detected(self):
        before = self.snapshot()
        self.sql(f"CREATE OR REPLACE FUNCTION {SIGNATURES[0]} RETURNS jsonb LANGUAGE plpgsql "
                 "SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN '[1]'::jsonb; END $$;")
        after = self.snapshot()
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])
        self.assertNotEqual(before['functions'][SIGNATURES[0]]['bodySha256'], after['functions'][SIGNATURES[0]]['bodySha256'])
        self.sql('CREATE OR REPLACE FUNCTION public.protected_routine() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;')
        self.assertNotEqual(after['permanentMetadataSha256'], self.snapshot()['permanentMetadataSha256'])

    def test_missing_required_relation_or_original_routine_refuses(self):
        self.sql('DROP TABLE prefunded_card.provider_aliases;')
        result = self.sql(self.source, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('financial_snapshot_scope_refused', result.stderr)
        self.sql('CREATE TABLE prefunded_card.provider_aliases ('
                 + TABLES['prefunded_card.provider_aliases'] + '); '
                 f'DROP FUNCTION {SIGNATURES[1]};')
        result = self.sql(self.source, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('financial_snapshot_scope_refused', result.stderr)

    def test_absent_projection_returns_explicit_empty_target_witness(self):
        name = 'prefunded_card.projections'
        before = self.witness(self.snapshot(), name)
        self.sql(f"DELETE FROM {name} WHERE operation_id='{OP}';")
        after = self.witness(self.snapshot(), name)
        self.assertEqual(after['targetCount'], 0)
        self.assertEqual(after['targetRows'], [])
        self.assertEqual(after['targetHash'], hashlib.sha256(b'[]').hexdigest())
        self.assertEqual(after['excludedTargetHash'], before['excludedTargetHash'])
        self.assertEqual(after['excludedTargetCount'], before['excludedTargetCount'])

    def test_allowed_table_cannot_be_replaced_with_a_foreign_relation(self):
        self.sql('DROP TABLE prefunded_card.provider_aliases; '
                 'CREATE FOREIGN DATA WRAPPER financial_snapshot_fixture; '
                 'CREATE SERVER financial_snapshot_fixture FOREIGN DATA WRAPPER financial_snapshot_fixture; '
                 'CREATE FOREIGN TABLE prefunded_card.provider_aliases '
                 '(operation_id uuid,provider_transaction_id text) SERVER financial_snapshot_fixture;')
        result = self.sql(self.source, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('financial_snapshot_scope_refused', result.stderr)

    def test_foreign_relations_remain_unsupported_and_not_read(self):
        self.sql('CREATE FOREIGN DATA WRAPPER financial_snapshot_fixture; '
                 'CREATE SERVER financial_snapshot_fixture FOREIGN DATA WRAPPER financial_snapshot_fixture; '
                 'CREATE FOREIGN TABLE public.foreign_guard (id integer) SERVER financial_snapshot_fixture;')
        evidence = self.snapshot()
        self.assertEqual(evidence['unsupportedRelations'], ['public.foreign_guard'])
        self.assertNotIn('public.foreign_guard', evidence['tableRows'])

    def test_wrong_physical_database_expiry_role_or_replication_mode_refuses_before_output(self):
        variations = ((HERE / 'financial_snapshot.sql').read_text(),
                      self.source.replace(DEADLINE, '2000-01-01T00:00:00Z'),
                      self.source.replace('DO $financial_identity$', 'SET LOCAL ROLE pg_read_all_data; DO $financial_identity$', 1),
                      self.source.replace('DO $financial_identity$', "SET LOCAL session_replication_role='replica'; DO $financial_identity$", 1))
        for source in variations:
            with self.subTest(source_sha=hashlib.sha256(source.encode()).hexdigest()):
                result = self.sql(source, checked=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
                self.assertIn('financial_snapshot_identity_refused', result.stderr)

    def test_same_physical_local_postgres_in_wrong_database_refuses_before_output(self):
        source = (HERE / 'financial_snapshot.sql').read_text().replace(SYSTEM, self.system)
        result = self.sql(source, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('financial_snapshot_identity_refused', result.stderr)
        self.assertEqual(self.snapshot()['identity']['database'], self.harness.database)

    def test_read_only_snapshot_changes_no_rows_or_permanent_metadata(self):
        before = self.snapshot()
        after = self.snapshot()
        for key in ('tableRows', 'functions', 'permanentMetadataSha256', 'allowedTargetWitnesses'):
            self.assertEqual(before[key], after[key], key)
        result = self.sql(self.source.replace('DO $financial_identity$',
                          'UPDATE public.protected_secret SET id=2; DO $financial_identity$', 1), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('read-only transaction', result.stderr)


if __name__ == '__main__':
    unittest.main()
