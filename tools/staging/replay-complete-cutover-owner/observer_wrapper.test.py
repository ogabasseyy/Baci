import hashlib
import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('observer_fixture', HERE / 'observer_fixture.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class ObserverWrapperTests(FIXTURE.ObserverFixture):
    def test_foreign_integration_refuses_before_any_observation(self):
        before = self.rows(observations=True)
        result = self.sql(f'SET SESSION AUTHORIZATION {FIXTURE.ROLE};' + self.query(
            integration='40000000-0000-4000-8000-000000000009'), checked=False)
        self.assertNotEqual(result.returncode, 0, 'unscoped legacy delegation accepted foreign integration')
        self.assertIn('accrual_observer_scope_refused', result.stderr)
        self.assertEqual(self.rows(observations=True), before)

    def test_exact_raw_utf8_fraction_calls_original_once_without_financial_credit(self):
        before = self.rows()
        raw = FIXTURE.payload()
        self.assertEqual(self.record(body=raw), 'applied')
        self.assertEqual(self.sql('SELECT amount_lexeme||\'|\'||amount_kobo::text FROM '
            'piggyvest_staging.interest_accrual_observations;').stdout.strip(),
            '406.8493150684931|406.8493150684931')
        self.assertEqual(self.sql('SELECT receipt_id::text||\'|\'||payload_sha256 FROM '
            'piggyvest_staging.interest_accrual_receipts;').stdout.strip(),
            '80000000-0000-4000-8000-000000000001|' + hashlib.sha256(raw.encode('utf-8')).hexdigest())
        self.assertEqual(self.sql("SELECT calls FROM pg_stat_user_functions WHERE funcid="
            + FIXTURE.literal(FIXTURE.ORIGINAL) + '::regprocedure;').stdout.strip(), '1')
        self.assertEqual(self.counts(), '1|1')
        self.assertEqual(self.rows(), before)
        self.assertEqual(self.catalog(FIXTURE.ORIGINAL), self.original_catalog)

    def test_retry_deduplication_and_conflicts_preserve_original_behavior(self):
        before = self.rows()
        self.assertEqual(self.record(), 'applied')
        self.assertEqual(self.record(), 'duplicate')
        self.assertEqual(self.record(body=FIXTURE.payload(event='synthetic-retry'), receipt=2), 'duplicate')
        self.assertEqual(self.record(body=FIXTURE.payload(event='synthetic-conflict', detail={'amount': 407}), receipt=3), 'conflict')
        self.assertEqual(self.record(body=FIXTURE.payload(accrual='different-accrual'), receipt=4), 'conflict')
        self.assertEqual(self.record(body=FIXTURE.payload(event='different-receipt-event'), receipt=1), 'conflict')
        self.assertEqual(self.counts(), '1|2')
        self.assertEqual(self.rows(), before)

    def test_invalid_raw_digest_and_unmapped_provider_namespace_never_credit(self):
        before = self.rows(observations=True)
        self.assertEqual(self.record(digest='a' * 64), 'invalid')
        self.assertEqual(self.record(body=FIXTURE.payload(detail={'amount': -1})), 'invalid')
        self.assertEqual(self.record(body=FIXTURE.payload(customer_id=FIXTURE.BUSINESS)), 'deferred')
        self.assertEqual(self.counts(), '0|0')
        self.assertEqual(self.rows(observations=True), before)

    def test_business_physical_database_and_session_refuse_without_side_effects(self):
        before = self.rows(observations=True)
        for values in ({'business': 'foreign'}, {'business': None}, {'system': '1'}, {'system': FIXTURE.PIN}):
            with self.subTest(values=values):
                result = self.sql(f'SET SESSION AUTHORIZATION {FIXTURE.ROLE};' + self.query(**values), checked=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('accrual_observer_scope_refused', result.stderr)
        result = self.sql(self.query(), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_scope_refused', result.stderr)
        self.assertEqual(self.rows(observations=True), before)

    def test_non_read_committed_or_read_only_call_is_rejected(self):
        before = self.rows(observations=True)
        for mode in ('ISOLATION LEVEL REPEATABLE READ', 'ISOLATION LEVEL SERIALIZABLE', 'READ ONLY'):
            result = self.sql(f'SET SESSION AUTHORIZATION {FIXTURE.ROLE};BEGIN {mode};' + self.query(), checked=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('accrual_observer_scope_refused', result.stderr)
        self.assertEqual(self.rows(observations=True), before)

    def test_expired_wrapper_refuses_even_a_duplicate(self):
        self.assertEqual(self.record(), 'applied')
        self.install('2000-01-01T00:00:00Z', frame=False)
        before = self.rows(observations=True)
        result = self.sql(f'SET SESSION AUTHORIZATION {FIXTURE.ROLE};' + self.query(), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_scope_refused', result.stderr)
        self.assertEqual(self.rows(observations=True), before)

    def cutoff(self):
        return self.sql("SELECT to_char((clock_timestamp()+interval '2 seconds') AT TIME ZONE 'UTC',"
                        "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');").stdout.strip()

    def test_long_lived_transaction_uses_server_clock_not_transaction_start(self):
        cutoff = self.cutoff()
        self.install(cutoff, frame=False)
        before = self.rows(observations=True)
        result = self.sql(f"SET SESSION AUTHORIZATION {FIXTURE.ROLE};BEGIN;"
            f"SELECT transaction_timestamp()<{FIXTURE.literal(cutoff)}::timestamptz;"
            f"SELECT pg_sleep(greatest(0,extract(epoch FROM {FIXTURE.literal(cutoff)}::timestamptz-clock_timestamp()))+0.05);"
            + self.query(), checked=False)
        self.assertEqual(result.stdout.strip().splitlines()[0], 't')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_scope_refused', result.stderr)
        self.assertEqual(self.rows(observations=True), before)

    def test_original_inserts_crossing_deadline_are_rolled_back_after_return(self):
        cutoff = self.cutoff()
        self.install(cutoff, frame=False)
        self.sql(f"""CREATE FUNCTION public.synthetic_deadline_barrier() RETURNS trigger LANGUAGE plpgsql AS $barrier$
BEGIN
 IF clock_timestamp()>={FIXTURE.literal(cutoff)}::timestamptz THEN RAISE EXCEPTION 'fixture_started_late'; END IF;
 PERFORM pg_sleep(greatest(0,extract(epoch FROM {FIXTURE.literal(cutoff)}::timestamptz-clock_timestamp()))+0.05);
 RETURN NEW;
END $barrier$;
CREATE TRIGGER synthetic_deadline_barrier AFTER INSERT ON piggyvest_staging.interest_accrual_receipts
 FOR EACH ROW EXECUTE FUNCTION public.synthetic_deadline_barrier();""")
        before = self.rows(observations=True)
        result = self.sql(f'SET SESSION AUTHORIZATION {FIXTURE.ROLE};' + self.query(), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_deadline_refused', result.stderr)
        self.assertEqual(self.counts(), '0|0')
        self.assertEqual(self.rows(observations=True), before)

    def test_default_rehearsal_rolls_back_and_original_definition_catalog_stays_exact(self):
        self.sql(f'DROP FUNCTION {FIXTURE.WRAPPER};')
        before = self.rows(observations=True)
        self.sql(self.copied(FIXTURE.SOURCE.read_text()))
        self.assertEqual(self.sql('SELECT to_regprocedure(' + FIXTURE.literal(FIXTURE.WRAPPER) + ') IS NULL;').stdout.strip(), 't')
        self.assertEqual(self.catalog(FIXTURE.ORIGINAL), self.original_catalog)
        self.assertEqual(self.rows(observations=True), before)

    def test_unmodified_installation_refuses_disposable_physical_database(self):
        self.sql(f'DROP FUNCTION {FIXTURE.WRAPPER};')
        result = self.sql(FIXTURE.SOURCE.read_text(), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('accrual_observer_install_refused', result.stderr)
        self.assertEqual(self.catalog(FIXTURE.ORIGINAL), self.original_catalog)


if __name__ == '__main__':
    unittest.main()
