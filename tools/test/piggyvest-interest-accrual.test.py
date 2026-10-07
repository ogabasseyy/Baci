import hashlib
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest

from piggyvest_interest_accrual_harness import (
    FUNCTION, INTEGRATION, MERCHANT, OBSERVATIONS, RECEIPTS, TOKEN, USER,
    ScratchInterestAccrual, literal, payload,
)


class InterestAccrual(ScratchInterestAccrual):

    def test_exact_decimal_and_no_financial_side_effects(self):
        self.assertEqual(self.record(payload('exact-event', 'exact-accrual'), receipt=10), 'applied')
        self.assertEqual(self.sql(f"SELECT amount_lexeme || '|' || amount_kobo::text FROM {OBSERVATIONS}"
                                 " WHERE provider_accrual_id='exact-accrual'").strip(), TOKEN + '|' + TOKEN)
        self.assertEqual(self.sql("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings"
                                 " WHERE account='principal'").strip(), '10000')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations').strip(), '1')
        self.assertEqual(self.sql('SELECT count(*) FROM savings_notifications.events').strip(), '0')
        self.assertEqual(self.sql('SELECT sum(current_amount) FROM public.customer_savings_goals').strip(), '200')
        output = self.sql(f"BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='{USER}';"
                          f"SELECT public.get_customer_savings_earnings('{MERCHANT}')->>'credited_interest_kobo'; ROLLBACK;")
        self.assertEqual(output.splitlines()[-2], '0')

    def test_duplicate_new_transport_and_changed_economics(self):
        self.assertEqual(self.record(payload('dup-event', 'dup-accrual'), receipt=20), 'applied')
        self.assertEqual(self.record(payload('dup-event', 'dup-accrual'), receipt=20), 'duplicate')
        self.assertEqual(self.record(payload('dup-new-event', 'dup-accrual', detail={'wallet_name': 'ignored'}), receipt=21), 'duplicate')
        self.assertEqual(self.record(payload('dup-numeric-event', 'dup-accrual').replace(TOKEN, TOKEN + '00'), receipt=22), 'duplicate')
        for number, detail in enumerate([{'amount': 407}, {'balance': 1}, {'percentage': 8},
                                         {'wallet_id': 'different'}, {'interest_type': 'differential'},
                                         {'interest_date': '2026-09-29T00:00:00Z'}], 23):
            self.assertEqual(self.record(payload(f'conflict-{number}', 'dup-accrual', detail=detail), receipt=number), 'conflict')
        self.assertEqual(self.record(payload('dup-event', 'different-accrual'), receipt=30), 'conflict')
        self.assertEqual(self.record(payload('split-conflict', 'dup-accrual',
            pvb_split_interest_with_wallet='01ARZ3NDEKTSV4RRFFQ69G5FAX',
            pvb_split_interest_with_wallet_name='Split wallet'), receipt=31), 'conflict')
        self.assertEqual(self.record(payload('new-receipt-event', 'dup-accrual'), receipt=20), 'conflict')
        self.assertEqual(self.record(payload('dup-event', 'dup-accrual'), receipt=20, digest='b' * 64), 'invalid')
        self.assertEqual(self.record(payload('dup-event', 'dup-accrual', pvb_wallet_name='Renamed'), receipt=20), 'conflict')
        self.assertEqual(self.sql(f"SELECT count(*) FROM {RECEIPTS} receipt JOIN {OBSERVATIONS} observation"
                                 " ON observation.id=receipt.observation_id WHERE provider_accrual_id='dup-accrual'").strip(), '3')

    def test_concurrent_same_event_and_distinct_same_day_ids(self):
        barrier = threading.Barrier(8, timeout=10)
        def attempt(number):
            barrier.wait()
            return self.record(payload('race-event', 'race-accrual'), receipt=100 + number)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count('applied'), 1)
        self.assertEqual(results.count('duplicate'), 7)
        self.assertEqual(self.record(payload('same-day-event', 'another-same-day-id'), receipt=110), 'applied')
        self.assertEqual(self.sql(f"SELECT count(*) FROM {OBSERVATIONS} WHERE provider_accrual_id"
                                 " IN ('race-accrual','another-same-day-id')").strip(), '2')

    def test_concurrent_same_event_different_accrual_is_fenced(self):
        barrier = threading.Barrier(2, timeout=10)
        def attempt(number):
            barrier.wait()
            return self.record(payload('conflicting-race-event', f'conflicting-race-{number}'), receipt=120 + number)
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, range(2)))
        self.assertCountEqual(results, ['applied', 'conflict'])
        self.assertEqual(self.sql(f"SELECT count(*) FROM {RECEIPTS} WHERE event_id='conflicting-race-event'").strip(), '1')
        self.assertEqual(self.sql(f"SELECT count(*) FROM {OBSERVATIONS} WHERE provider_accrual_id LIKE 'conflicting-race-%'").strip(), '1')

    def test_nullable_ulid_split_and_name_are_validated_without_name_economics(self):
        destination = '01ARZ3NDEKTSV4RRFFQ69G5FAX'
        for number, changes in enumerate([
            {'pvb_split_interest_with_wallet': 'malformed', 'pvb_split_interest_with_wallet_name': 'Split'},
            {'pvb_split_interest_with_wallet': destination},
            {'pvb_split_interest_with_wallet_name': 'Split'},
            {'pvb_split_interest_with_wallet': destination, 'pvb_split_interest_with_wallet_name': 1},
            {'pvb_split_interest_with_wallet': destination, 'pvb_split_interest_with_wallet_name': 'x' * 513},
        ], 500):
            self.assertEqual(self.record(payload(f'split-invalid-{number}', f'split-invalid-{number}', **changes), receipt=number), 'invalid')
        self.assertEqual(self.record(payload('split-valid-event', 'split-valid-accrual',
            pvb_split_interest_with_wallet=destination, pvb_split_interest_with_wallet_name='Split'), receipt=510), 'applied')
        self.assertEqual(self.record(payload('split-renamed-event', 'split-valid-accrual',
            pvb_split_interest_with_wallet=destination, pvb_split_interest_with_wallet_name='Renamed'), receipt=511), 'duplicate')
        self.assertEqual(self.sql(f"SELECT split_destination_wallet_id FROM {OBSERVATIONS} WHERE provider_accrual_id='split-valid-accrual'").strip(), destination)

    def test_absent_worker_is_not_created_or_granted_at_installation(self):
        self.assertEqual(self.absent_worker, '0')
        self.assertEqual(self.absent_worker_grants, '0')
        self.assertEqual(self.later_worker_can_execute, 'f')

    def test_economic_bounds_mirror_schema_without_rounding(self):
        for number, detail in enumerate([{'amount': 9007199254740992}, {'balance': 9007199254740992},
                                         {'percentage': 100.01}, {'percentage': -1}], 600):
            self.assertEqual(self.record(payload(f'bound-invalid-{number}', f'bound-invalid-{number}', detail=detail), receipt=number), 'invalid')
        self.assertEqual(self.record(payload('bounds-valid-event', 'bounds-valid-accrual',
            detail={'amount': 9007199254740991, 'balance': 9007199254740991, 'percentage': 100}), receipt=610), 'applied')

    def test_digest_is_bound_to_exact_original_json_text(self):
        raw = payload('digest-event', 'digest-accrual', pvb_wallet_name='Synthetic ₦ wallet').replace('\\u20a6', '₦') + '\n'
        digest = hashlib.sha256(raw.encode('utf-8')).hexdigest()
        self.assertEqual(self.record(raw, receipt=620, digest='a' * 64), 'invalid')
        self.assertEqual(self.record(raw, receipt=621, digest=digest), 'applied')
        self.assertEqual(self.record(raw.rstrip(), receipt=622, digest=digest), 'invalid')
        self.assertEqual(self.sql(f"SELECT payload_sha256 FROM {RECEIPTS} WHERE event_id='digest-event'").strip(), digest)
        self.assertEqual(self.sql("SELECT encode(pg_catalog.sha256(convert_to('abc','UTF8')),'hex')").strip(),
                         'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

    def test_reader_caps_latest_dated_observations_without_outstanding_sum(self):
        statements = [self.record_query(payload(f'cap-event-{number}', f'cap-accrual-{number}',
            detail={'interest_date': '2026-09-30T00:00:00Z'}), receipt=700 + number) for number in range(105)]
        results = self.sql(';'.join(statements), 'piggyvest_staging_ledger_worker').splitlines()
        self.assertEqual(results, ['applied'] * 105)
        response = self.read()
        self.assertEqual(len(response['observations']), 100)
        self.assertEqual(set(response), {'observations', 'spendable', 'hasMore'})
        self.assertIs(response['hasMore'], True)
        self.assertTrue(all(row['interestDate'].startswith('2026-09-30') and row['spendable'] is False
                            for row in response['observations']))

    def test_invalid_identity_and_ownership_are_refused(self):
        self.assertEqual(self.record(business='wrong'), 'deferred')
        self.assertEqual(self.record(payload(pvb_wallet='unknown')), 'deferred')
        self.assertEqual(self.record(payload(customer_id='wrong')), 'deferred')
        self.sql(f"UPDATE piggyvest_staging.integrations SET enabled=false WHERE id='{INTEGRATION}'")
        try:
            self.assertEqual(self.record(), 'deferred')
        finally:
            self.sql(f"UPDATE piggyvest_staging.integrations SET enabled=true WHERE id='{INTEGRATION}'")
        self.sql("UPDATE public.customer_savings_goals SET customer_id='20000000-0000-4000-8000-000000000002'"
                 " WHERE id='30000000-0000-4000-8000-000000000001'")
        try:
            self.assertEqual(self.record(), 'deferred')
        finally:
            self.sql("UPDATE public.customer_savings_goals SET customer_id='20000000-0000-4000-8000-000000000001'"
                     " WHERE id='30000000-0000-4000-8000-000000000001'")
        with self.assertRaisesRegex(AssertionError, 'identity refused'):
            self.record(pin='1')
        with self.assertRaisesRegex(AssertionError, 'identity refused'):
            self.record(prefix='BEGIN ISOLATION LEVEL REPEATABLE READ; ')
        self.sql(f"GRANT USAGE ON SCHEMA piggyvest_staging TO wrong_worker; GRANT EXECUTE ON FUNCTION {FUNCTION} TO wrong_worker")
        with self.assertRaisesRegex(AssertionError, 'identity refused'):
            self.record(user='wrong_worker')
        with self.assertRaisesRegex(AssertionError, 'identity refused'):
            self.record(user='harness_admin', prefix='SET ROLE piggyvest_staging_ledger_worker; ')

    def test_private_grants_immutable_rows_and_customer_read_scope(self):
        self.assertEqual(self.record(payload('read-event', 'read-accrual'), receipt=200), 'applied')
        self.assertEqual(self.record(payload('read-diff-event', 'read-diff-accrual', detail={'interest_type': 'differential'}), receipt=201), 'applied')
        for role in ['anon', 'authenticated', 'service_role', 'piggyvest_staging_ledger_worker']:
            for table in [OBSERVATIONS, RECEIPTS]:
                self.assertEqual(self.sql(f"SELECT has_table_privilege('{role}','{table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')").strip(), 'f')
            if role != 'piggyvest_staging_ledger_worker':
                self.assertEqual(self.sql(f"SELECT has_function_privilege('{role}','{FUNCTION}','EXECUTE')").strip(), 'f')
        for statement in [f'DELETE FROM {OBSERVATIONS}', f'UPDATE {OBSERVATIONS} SET amount_kobo=1',
                          f'TRUNCATE {RECEIPTS}, {OBSERVATIONS}', f'DELETE FROM {RECEIPTS}']:
            with self.assertRaisesRegex(AssertionError, 'immutable'):
                self.sql(statement)
        response = self.read()
        self.assertEqual(set(response), {'observations', 'spendable', 'hasMore'})
        self.assertIs(response['spendable'], False)
        observations = response['observations']
        self.assertTrue(all(row['interestDate'].startswith('2026-09-28') for row in observations))
        self.assertTrue(any(row['amountKobo'] == TOKEN and row['spendable'] is False for row in observations))
        self.assertTrue(all(row['interestType'] == 'original' for row in observations))
        self.assertEqual(self.read('10000000-0000-4000-8000-000000000002',
                                   '50000000-0000-4000-8000-000000000002')['observations'], [])
        with self.assertRaisesRegex(AssertionError, 'Customer scope unavailable'):
            self.read('10000000-0000-4000-8000-000000000002')
        with self.assertRaisesRegex(AssertionError, 'Authentication required'):
            self.read(actor='')

    def test_malformed_economics_do_not_write_observations(self):
        before = self.sql(f'SELECT count(*) FROM {OBSERVATIONS}').strip()
        for body in [payload(detail={'amount': '406.8'}), payload(detail={'amount': -1}),
                     payload(detail={'interest_date': 'not-a-date'}), payload(detail={'id': ''}),
                     payload(detail={'interest_type': 'unknown'}), payload(eventType='interest-payout.success')]:
            self.assertEqual(self.record(body, receipt=300), 'invalid')
        self.assertEqual(self.record(payload(), receipt=300, digest='invalid'), 'invalid')
        self.assertEqual(self.sql(f'SELECT count(*) FROM {OBSERVATIONS}').strip(), before)

    def test_receipt_failure_rolls_back_observation(self):
        self.sql(f"CREATE FUNCTION public.reject_accrual_receipt() RETURNS trigger LANGUAGE plpgsql AS $$"
                 "BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$;"
                 f"CREATE TRIGGER reject_receipt BEFORE INSERT ON {RECEIPTS} FOR EACH ROW"
                 " EXECUTE FUNCTION public.reject_accrual_receipt()")
        try:
            with self.assertRaisesRegex(AssertionError, 'synthetic receipt failure'):
                self.record(payload('rollback-event', 'rollback-accrual'), receipt=400)
            self.assertEqual(self.sql(f"SELECT count(*) FROM {OBSERVATIONS} WHERE provider_accrual_id='rollback-accrual'").strip(), '0')
        finally:
            self.sql(f'DROP TRIGGER reject_receipt ON {RECEIPTS}; DROP FUNCTION public.reject_accrual_receipt()')


if __name__ == '__main__':
    unittest.main()
