import importlib.util
import json
from pathlib import Path
import subprocess
import unittest


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SPEC = importlib.util.spec_from_file_location('checkout_scratch', ROOT / 'tools/test/prefunded-card-checkout.test.py')
CHECKOUT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKOUT)
SPEC = importlib.util.spec_from_file_location('claim_installer', HERE / 'installer.py')
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class Scratch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        CHECKOUT.PrefundedFirstCardCheckout.setUpClass()
        cls.addClassCleanup(CHECKOUT.PrefundedFirstCardCheckout.tearDownClass)
        cls.harness = CHECKOUT.PrefundedFirstCardCheckout.harness
        cls.harness.sql("CREATE ROLE postgres LOGIN SUPERUSER;")

    def setUp(self):
        self.database = 'ci_' + self._testMethodName[:55]
        self.harness.sql(f'CREATE DATABASE "{self.database}" TEMPLATE postgres')
        self.addCleanup(lambda: self.harness.sql(f'DROP DATABASE "{self.database}"'))
        self.sql('ALTER TABLE prefunded_card.checkout_intents OWNER TO postgres; ' + ''.join(
            f'ALTER FUNCTION {signature} OWNER TO postgres; ' for signature in INSTALLER.SIGNATURES))
        self.snapshot_sql = (HERE / 'snapshot.sql').read_text().replace('__CLOSURE__',
            INSTALLER._closure(INSTALLER._source(None))).rstrip().rstrip(';')

    def sql(self, statement, user='postgres'):
        result = subprocess.run([str(CHECKOUT.CUSTOMER.MODULE.BIN / 'psql'), '-XqAt', '-w',
            '-v', 'ON_ERROR_STOP=1', '-h', str(self.harness.path), '-p', '55461',
            '-U', user, '-d', self.database, '-c', statement], text=True,
            capture_output=True, env=self.harness.environment, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    def snapshot(self):
        return json.loads(self.sql(self.snapshot_sql))

    def temporary_expected(self, evidence):
        return 'CREATE TEMP TABLE cb_expected ON COMMIT DROP AS SELECT ' + INSTALLER._literal(
            INSTALLER._json(evidence)) + '::jsonb evidence;'

    def snapshot_and_guard(self):
        return 'CREATE TEMP TABLE cb_snapshot ON COMMIT DROP AS ' + self.snapshot_sql + ';' + (
            HERE / 'guard.sql').read_text()


class SnapshotTests(Scratch):
    def test_read_only_capture_contains_every_permanent_table_without_raw_financial_rows(self):
        result = json.loads(self.sql('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; '
            + self.snapshot_sql + ';ROLLBACK;'))
        names = json.loads(self.sql("SELECT jsonb_agg(namespace.nspname||'.'||relation.relname) "
            "FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace "
            "WHERE relation.relkind IN ('r','p','S','m') AND relation.relpersistence<>'t' "
            "AND namespace.nspname<>'information_schema' AND namespace.nspname !~ '^pg_'"))
        self.assertEqual(set(result['tableRows']), set(names))
        self.assertTrue(set(INSTALLER.REQUIRED_TABLES) <= set(names))
        self.assertTrue(all(type(row['count']) is int and len(row['sha256']) == 64
            for row in result['tableRows'].values()))
        self.assertEqual(result['identity']['database'], self.database)
        self.assertEqual(result['identity']['systemIdentifier'], self.harness.system)
        self.assertEqual(set(result['functions']), set(INSTALLER.SIGNATURES))
        self.assertNotIn('AUTH_', json.dumps(result['tableRows']))

    def test_balance_mutation_changes_full_row_hash(self):
        before = self.snapshot()
        self.sql('UPDATE public.customer_savings_goals SET current_amount=current_amount+1')
        after = self.snapshot()
        self.assertNotEqual(before['tableRows']['public.customer_savings_goals'],
            after['tableRows']['public.customer_savings_goals'])

    def test_captured_oid_types_match_the_renderer_contract_not_postgres_oid_strings(self):
        evidence = self.snapshot()
        self.assertIs(type(evidence['identity']['databaseOid']), int)
        self.assertIs(type(evidence['identity']['roleOid']), int)
        for routine in evidence['functions'].values():
            self.assertIs(type(routine['oid']), int)
            self.assertIs(type(routine['ownerOid']), int)
        self.assertTrue(all(type(row['oid']) is int for row in evidence['tableRows'].values()))

    def test_permanent_privilege_change_is_in_metadata_hash(self):
        before = self.snapshot()
        self.sql('GRANT SELECT ON public.customer_savings_goals TO PUBLIC')
        self.assertNotEqual(before['permanentMetadataSha256'], self.snapshot()['permanentMetadataSha256'])

    def test_metadata_excludes_only_two_prosrc_fields(self):
        source = INSTALLER._source(None)
        before = self.snapshot()
        pins = []
        for signature, (anchor, replacement) in zip(INSTALLER.SIGNATURES, INSTALLER._patches(source)):
            definition = self.sql(f"SELECT pg_get_functiondef('{signature}'::regprocedure)")
            self.sql(definition.replace(anchor, replacement))
            pins.append(signature)
        after = self.snapshot()
        self.assertEqual(before['tableRows'], after['tableRows'])
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])
        self.assertEqual(after['functions'], INSTALLER._after(before, source))
        self.sql('CREATE FUNCTION public.claim_snapshot_fixture() RETURNS integer LANGUAGE sql AS $$SELECT 1$$')
        created = self.snapshot()
        self.sql('CREATE OR REPLACE FUNCTION public.claim_snapshot_fixture() RETURNS integer LANGUAGE sql AS $$SELECT 2$$')
        self.assertNotEqual(created['permanentMetadataSha256'], self.snapshot()['permanentMetadataSha256'])

    def test_materialized_relation_is_fully_hashed_not_silently_exempted(self):
        self.sql('CREATE MATERIALIZED VIEW public.claim_materialized AS SELECT 10000 amount')
        result = self.snapshot()
        self.assertEqual(result['unsupportedRelations'], [])
        self.assertEqual(result['tableRows']['public.claim_materialized']['count'], 1)
        self.assertEqual(result['tableRows']['public.claim_materialized']['kind'], 'm')

    def test_sequence_state_is_read_without_advancing_it(self):
        self.sql('CREATE SEQUENCE public.claim_sequence')
        before = self.snapshot()
        self.assertEqual(before['tableRows']['public.claim_sequence'], self.snapshot()['tableRows']['public.claim_sequence'])
        self.sql("SELECT nextval('public.claim_sequence')")
        self.assertNotEqual(before['tableRows']['public.claim_sequence'], self.snapshot()['tableRows']['public.claim_sequence'])

    def test_quoted_relation_names_do_not_collide_or_escape_identifiers(self):
        self.sql('CREATE SCHEMA "claim.dot"; CREATE SCHEMA claim; '
            'CREATE TABLE "claim.dot".row(amount integer); CREATE TABLE claim."dot.row"(amount integer); '
            'INSERT INTO "claim.dot".row VALUES(0); INSERT INTO claim."dot.row" VALUES(10000)')
        rows = self.snapshot()['tableRows']
        self.assertIn('"claim.dot"."row"', rows)
        self.assertIn('claim."dot.row"', rows)
        self.assertNotEqual(rows['"claim.dot"."row"']['sha256'], rows['claim."dot.row"']['sha256'])


if __name__ == '__main__':
    unittest.main()
