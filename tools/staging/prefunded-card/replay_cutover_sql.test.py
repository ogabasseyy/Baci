import importlib.util
from pathlib import Path
import subprocess
import unittest

from replay_cutover_sql import LEGACY_BASELINE_SHA256, LEGACY_UPDATED_SHA256, _render_cutover_fixture, render_cutover


DIRECTORY = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('enrollment_fixture', DIRECTORY / 'enrollment-owner-candidate.test.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SIGNATURE = 'prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)'
RESOLVER = 'prefunded_card.resolve_replay_enrollment(uuid,uuid,uuid,text,text,text,jsonb)'


class ReplayCutoverSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = MODULE.EnrollmentOwnerCandidate
        cls.fixture.setUpClass()
        cls.addClassCleanup(cls.fixture.tearDownClass)
        cls.enrollment = (DIRECTORY / 'enrollment-owner-candidate.sql').read_text()
        cls.legacy = (DIRECTORY / 'evidence-legacy.sql').read_text()
        start = cls.legacy.index("  IF receipt.observation->>'providerTransactionId' IS DISTINCT FROM p_provider_transaction_id THEN")
        end = cls.legacy.index("  IF receipt.observation->>'kind'<>'bank_inflow'", start)
        old = (cls.legacy[:start] + cls.legacy[end:]).replace('DECLARE legacy_duplicate boolean:=false;\n', '')
        cls.old = old.replace("  IF receipt.observation->>'kind'<>'bank_inflow'",
                              "  IF receipt.observation->>'kind'<>'bank_inflow' OR receipt.observation->>'providerTransactionId' IS DISTINCT FROM p_provider_transaction_id", 1)
        cls.old = cls.old.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
        cls.rendered = _render_cutover_fixture(cls.enrollment, cls.legacy)

    def clone(self, suffix):
        database = self.fixture.clone('cutover_' + suffix)
        self.addCleanup(self.fixture.database.sql, 'DROP DATABASE ' + database)
        self.fixture.sql(self.old, database)
        self.assertEqual(self.digest(database), LEGACY_BASELINE_SHA256)
        return database

    def digest(self, database, signature=SIGNATURE):
        return self.fixture.sql("SELECT encode(sha256(convert_to(pg_get_functiondef('" + signature +
                                "'::regprocedure),'UTF8')),'hex')", database)

    def metadata(self, database):
        return self.fixture.sql("SELECT oid::text||':'||proowner::text||':'||coalesce(proacl::text,'NULL') "
                                "FROM pg_proc WHERE oid='" + SIGNATURE + "'::regprocedure", database)

    def state(self, database):
        return self.fixture.sql("""SELECT json_build_array(
          (SELECT count(*) FROM prefunded_card.credit_routes),
          (SELECT current_amount FROM public.customer_savings_goals),
          (SELECT count(*) FROM public.customer_savings_contributions),
          (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal'),
          (SELECT count(*) FROM prefunded_card.bank_projections),
          (SELECT count(*) FROM prefunded_card.operations),
          (SELECT reserved_kobo FROM prefunded_card.treasury_bindings),
          (SELECT consumed_kobo FROM prefunded_card.treasury_bindings));""", database)

    def run_sql(self, database, source=None, fail_after_route=False, test_mode='on'):
        path = self.fixture.database.path / (database + '.sql')
        path.write_text(source if source is not None else self.rendered)
        legacy = MODULE.LEGACY
        return self.fixture.legacy.psql(
            database, '-v', 'enrollment_owner_test=' + test_mode,
            '-v', 'enrollment_owner_system=' + self.fixture.database.system,
            '-v', 'enrollment_owner_fail_after_route=' + ('on' if fail_after_route else 'off'),
            '-v', 'enrollment_owner_integration=' + legacy.INTEGRATION,
            '-v', 'enrollment_owner_business=business', '-v', 'enrollment_owner_merchant=' + legacy.MERCHANT,
            '-v', 'enrollment_owner_customer=' + legacy.CUSTOMER, '-v', 'enrollment_owner_goal=' + legacy.GOAL,
            '-v', 'enrollment_owner_wallet=scratch-private-wallet',
            '-v', 'enrollment_owner_provider_customer=scratch-event-customer', '-f', path, check=False)

    def assert_rolled_back(self, database, metadata, state):
        self.assertEqual(self.digest(database), LEGACY_BASELINE_SHA256)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_real_baseline_atomic_delta_retry_preserves_oid_owner_acl_and_amounts(self):
        database = self.clone('success')
        metadata = self.metadata(database)
        alias_replay = """SET SESSION AUTHORIZATION prefunded_treasury_operator;
          SELECT prefunded_card.apply_verified_legacy_inflow('legacy-eventdata-uuid','legacy-data',
            'legacy-event','scratch-event-customer','scratch-private-wallet',10000,0,
            'legacy-reference','legacy-session','2026-09-26T12:00:00Z');"""
        self.assertEqual(self.fixture.sql(alias_replay, database), 'reconciliation_required')
        result = self.run_sql(database)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[-1], 'enrolled')
        self.assertEqual(self.digest(database), LEGACY_UPDATED_SHA256)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.fixture.sql(alias_replay, database), 'duplicate')
        self.assertEqual(self.state(database), '[1, 100.00, 1, 10000, 1, 0, 0, 0]')
        retried = self.run_sql(database)
        self.assertEqual(retried.returncode, 0, retried.stderr)
        self.assertEqual(retried.stdout.strip().splitlines()[-1], 'already_enrolled')
        self.assertEqual(self.metadata(database), metadata)
        deletion = self.fixture.legacy.psql(database, '-c', 'DELETE FROM prefunded_card.credit_routes', check=False)
        self.assertNotEqual(deletion.returncode, 0)
        self.assertIn('prefunded projection evidence immutable', deletion.stderr)
        self.assertEqual(self.state(database), '[1, 100.00, 1, 10000, 1, 0, 0, 0]')

    def test_verify_only_rolls_back_delta_route_and_leaves_financial_history_unchanged(self):
        database = self.clone('verify')
        metadata, state = self.metadata(database), self.state(database)
        self.assertTrue(self.rendered.endswith('COMMIT;\n'))
        rehearsal = _render_cutover_fixture(self.enrollment, self.legacy, rehearsal=True)
        self.assertEqual(rehearsal, self.rendered.removesuffix('COMMIT;\n') + 'ROLLBACK;\n')
        self.assertEqual(render_cutover(self.enrollment, self.legacy, rehearsal=True),
                         render_cutover(self.enrollment, self.legacy).removesuffix('COMMIT;\n') + 'ROLLBACK;\n')
        result = self.run_sql(database, rehearsal)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_rolled_back(database, metadata, state)

    def test_failure_after_route_insert_rolls_back_function_replacement_and_route(self):
        database = self.clone('failure')
        metadata, state = self.metadata(database), self.state(database)
        result = self.run_sql(database, fail_after_route=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('legacy route rehearsal rollback', result.stderr)
        self.assert_rolled_back(database, metadata, state)

    def test_refuses_unknown_baseline_and_resolver_drift_without_changing_either(self):
        for suffix, signature in (('foreign', SIGNATURE), ('resolver', RESOLVER)):
            with self.subTest(signature=signature):
                database = self.clone(suffix)
                self.fixture.sql('ALTER FUNCTION ' + signature + ' SECURITY INVOKER', database)
                digest, state = self.digest(database, signature), self.state(database)
                for rehearsal in (True, False):
                    source = _render_cutover_fixture(self.enrollment, self.legacy, rehearsal=rehearsal)
                    result = self.run_sql(database, source)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('replay cutover function baseline refused', result.stderr)
                    self.assertEqual(self.digest(database, signature), digest)
                    self.assertEqual(self.state(database), state)

    def test_rehearsal_executes_owner_and_treasury_guards_and_rolls_back_delta(self):
        for suffix, mutation, refusal in (
            ('owner', 'ALTER FUNCTION ' + SIGNATURE + ' OWNER TO prefunded_treasury_operator',
             'replay cutover function baseline refused'),
            ('scope', "SET session_replication_role=replica; UPDATE prefunded_card.treasury_bindings "
             "SET reserved_kobo=1; SET session_replication_role=origin", 'legacy route treasury scope refused'),
        ):
            with self.subTest(suffix=suffix):
                database = self.clone(suffix)
                self.fixture.sql(mutation, database)
                metadata, state = self.metadata(database), self.state(database)
                result = self.run_sql(database, _render_cutover_fixture(self.enrollment, self.legacy, rehearsal=True))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(refusal, result.stderr)
                self.assert_rolled_back(database, metadata, state)

    def test_fixture_cannot_target_live_and_public_renderer_cannot_enable_fixture_mode(self):
        database = self.clone('target')
        result = self.run_sql(database, test_mode='off')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('replay cutover scratch scope refused', result.stderr)
        self.assertEqual(self.digest(database), LEGACY_BASELINE_SHA256)
        result = self.run_sql(database, render_cutover(self.enrollment, self.legacy))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('replay cutover owner scope refused', result.stderr)

    def test_wrong_target_refuses_before_waiting_on_locked_business_tables(self):
        database = self.clone('locked')
        process = subprocess.Popen([
            str(MODULE.LEGACY.MODULE.BIN / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
            '-h', str(self.fixture.database.path), '-p', '55461', '-U', 'harness_admin', '-d', database,
        ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=self.fixture.database.environment)
        try:
            process.stdin.write("BEGIN; LOCK TABLE public.customer_savings_contributions "
                                "IN ACCESS EXCLUSIVE MODE; SELECT 'locked';\n")
            process.stdin.flush()
            self.assertEqual(process.stdout.readline().strip(), 'locked')
            for rehearsal in (False, True):
                source = render_cutover(self.enrollment, self.legacy, rehearsal=rehearsal)
                result = self.run_sql(database, source, test_mode='off')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('replay cutover owner scope refused', result.stderr)
        finally:
            process.communicate('ROLLBACK;\n\\q\n', timeout=10)

    def test_rejects_unreviewed_source_nonboolean_rehearsal_and_baseline_override(self):
        for enrollment, legacy in ((self.enrollment + '\n', self.legacy), (self.enrollment, self.legacy + '\n')):
            with self.assertRaises(ValueError):
                render_cutover(enrollment, legacy)
        for invalid in (None, 0, 1, 'false', 'true'):
            with self.subTest(rehearsal=invalid), self.assertRaises(ValueError):
                render_cutover(self.enrollment, self.legacy, rehearsal=invalid)
        with self.assertRaises(TypeError):
            render_cutover(self.enrollment, self.legacy, test_baseline_sha256=LEGACY_BASELINE_SHA256)


if __name__ == '__main__':
    unittest.main()
