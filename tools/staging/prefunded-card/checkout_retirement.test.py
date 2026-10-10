import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import unittest
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('checkout_harness', ROOT / 'tools/test/prefunded-card-checkout.test.py')
CHECKOUT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKOUT)


class CheckoutRetirementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        CHECKOUT.PrefundedFirstCardCheckout.setUpClass()
        cls.addClassCleanup(CHECKOUT.PrefundedFirstCardCheckout.tearDownClass)
        cls.fixture = CHECKOUT.PrefundedFirstCardCheckout()
        cls.db = cls.fixture.harness
        original_sql = cls.db.sql

        def concise_sql(query, user='harness_admin'):
            try:
                return original_sql(query, user)
            except subprocess.CalledProcessError as error:
                error.cmd = 'scratch PostgreSQL: ' + error.stderr.strip()
                raise

        cls.db.sql = concise_sql
        for filename in ('evidence-storage.sql', 'evidence-projection-storage.sql', 'evidence-inflow.sql',
                         'evidence-projection.sql', 'evidence-conflict.sql', 'reversal-storage.sql',
                         'reversal-functions.sql', 'customer-capability.sql'):
            cls.db.file(HERE / filename)
        cls.snapshot = cls.fixture.execute('checkout_reserve', cls.fixture.scope(), cls.fixture.request())
        cls.intent = cls.snapshot['intent']
        cls.selection = {key: cls.intent[key] for key in ('intentId', 'customerId', 'actorId', 'goalId')}
        claim = cls.fixture.execute('checkout_claim_initialization', cls.fixture.scope(), cls.selection, user=CHECKOUT.VERIFIER)
        cls.fixture.execute('checkout_mark_initialization_uncertain', cls.fixture.scope(), cls.selection, claim, user=CHECKOUT.VERIFIER)

    def test_retirement_fences_old_operation_and_releases_only_its_reservation(self):
        from checkout_retirement_patches import render_patches
        operation_id = self.intent['intentId']
        self.db.sql('BEGIN; ' + (HERE / 'checkout-retirement-storage.sql').read_text()
                    + render_patches(HERE, owner='harness_admin') + ' COMMIT;')
        evidence = dict(providerResult='transaction_not_found', providerHttp=400, verifiedAt=datetime.now(timezone.utc).isoformat(),
                        configurationSha256='a' * 64, operatorApproval='retire-unconfirmed-test-checkout-v1')
        arguments = {**self.fixture.scope(), **self.selection, 'amountKobo': 10000,
                     'reference': self.intent['reference'], 'requestFingerprint': self.intent['requestFingerprint'],
                     'evidence': evidence}
        self.db.sql((HERE / 'checkout-retirement-apply.sql').read_text())
        call = f"SELECT prefunded_card.retire_unconfirmed_checkout('{json.dumps(arguments)}'::jsonb)"
        with self.assertRaises(subprocess.CalledProcessError):
            self.db.sql(call, CHECKOUT.APP)
        for change in (
            f"UPDATE prefunded_card.operations SET transfer_attempted_at=clock_timestamp() WHERE id='{operation_id}'",
            f"UPDATE prefunded_card.operations SET verification_lease_expires_at=clock_timestamp()+interval '1 minute' WHERE id='{operation_id}'",
            f"UPDATE prefunded_card.dispatch_queue SET lease_expires_at=clock_timestamp()+interval '1 minute' WHERE operation_id='{operation_id}'",
            f"UPDATE prefunded_card.treasury_bindings SET reserved_kobo=9999 WHERE id='{CHECKOUT.TREASURY}'",
        ):
            with self.subTest(refusal=change):
                self.db.sql(f"""DO $test$ BEGIN BEGIN
                  {change}; {call.replace('SELECT ', 'PERFORM ', 1)};
                  RAISE EXCEPTION 'advanced state was incorrectly retired';
                  EXCEPTION WHEN insufficient_privilege THEN NULL;
                  END; END $test$;""")
        for field, value in (('requestFingerprint', 'b' * 64), ('amountKobo', 9999), ('reference', 'wrong')):
            invalid = {**arguments, field: value}
            with self.assertRaises(subprocess.CalledProcessError):
                self.db.sql(f"SELECT prefunded_card.retire_unconfirmed_checkout('{json.dumps(invalid)}'::jsonb)")
        expired = {**arguments, 'evidence': {**evidence, 'verifiedAt': '2026-09-01T00:00:00Z'}}
        with self.assertRaises(subprocess.CalledProcessError):
            self.db.sql(f"SELECT prefunded_card.retire_unconfirmed_checkout('{json.dumps(expired)}'::jsonb)")
        self.assertEqual(self.db.sql('SELECT count(*) FROM prefunded_card.checkout_retirements'), '0')
        before = self.db.sql('SELECT current_amount FROM public.customer_savings_goals')
        results = self.retire_with_blocked_writes(call, operation_id)
        self.assertEqual([value['status'] for value in results].count('retired_unconfirmed'), 1)
        self.assertEqual([value['status'] for value in results].count('already_retired'), 7)
        self.assertEqual(json.loads(self.db.sql(call))['status'], 'already_retired')
        self.assertEqual(self.db.sql(f"SELECT reserved_kobo FROM prefunded_card.treasury_bindings WHERE id='{CHECKOUT.TREASURY}'"), '0')
        self.assertEqual(self.db.sql('SELECT current_amount FROM public.customer_savings_goals'), before)
        self.assertEqual(self.db.sql('SELECT collection_status FROM prefunded_card.operations'), 'pending')
        self.assertEqual(self.fixture.execute('checkout_read', self.fixture.scope(), self.selection)['phase'], 'retired_unconfirmed')
        self.assertEqual(self.fixture.execute('checkout_reserve', self.fixture.scope(), self.fixture.request())['phase'], 'retired_unconfirmed')
        self.assertTrue(self.fixture.capability(10000)['enabled'])
        collection = dict(intentId=operation_id, reference=self.intent['reference'], providerTransactionId='900001',
                          amountKobo=10000, currency='NGN', domain='test', authorization=dict(
                              authorizationCode='AUTH_fixture', signature='signature-fixture', customerCode='CUS_fixture',
                              email=self.intent['email'], reusable=True, brand='visa', last4='4081', expiryMonth='12', expiryYear='2030'))
        with self.assertRaises(subprocess.CalledProcessError):
            self.fixture.execute('checkout_promote_collection', self.fixture.scope(), self.selection, collection, user=CHECKOUT.VERIFIER)
        self.assertEqual(self.db.sql('SELECT count(*) FROM public.customer_saved_payment_methods'), '0')
        for change in ("collection_status='verified_success'", "transfer_status='dispatching'", "projection_status='applied'",
                       "verification_fence=verification_fence+1", "checkout_retired=false"):
            with self.assertRaises(subprocess.CalledProcessError):
                self.db.sql(f"UPDATE prefunded_card.operations SET {change} WHERE id='{operation_id}'")
        for command in (
            f"UPDATE prefunded_card.checkout_intents SET phase='pending' WHERE id='{operation_id}'",
            'DELETE FROM prefunded_card.checkout_retirements',
            'TRUNCATE prefunded_card.checkout_retirements',
            f"INSERT INTO prefunded_card.provider_aliases VALUES('{self.intent['integrationId']}','late-tx','{operation_id}')",
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                self.db.sql(command)
        self.db.sql(f"UPDATE prefunded_card.operations SET projection_status='reconciliation_required' WHERE id='{operation_id}'")
        next_request = self.fixture.request('80000000-0000-4000-8000-0000000000fd')
        new_intent = self.fixture.execute('checkout_reserve', self.fixture.scope(), next_request)['intent']
        self.assertNotEqual(new_intent['intentId'], operation_id)
        self.assertEqual(self.db.sql(f"SELECT reserved_kobo FROM prefunded_card.treasury_bindings WHERE id='{CHECKOUT.TREASURY}'"), '10000')
        self.assertEqual(json.loads(self.db.sql(call))['status'], 'already_retired')
        self.assertEqual(self.db.sql(f"SELECT reserved_kobo FROM prefunded_card.treasury_bindings WHERE id='{CHECKOUT.TREASURY}'"), '10000')
        self.db.sql(f'GRANT EXECUTE ON FUNCTION prefunded_card.claim_reconciliation(uuid,integer) TO {CHECKOUT.APP}')
        self.assertEqual(self.db.sql(f"SELECT prefunded_card.claim_reconciliation('{operation_id}',30)", CHECKOUT.APP), '{"outcome": "not_verifiable"}')
        with self.assertRaises(subprocess.CalledProcessError) as credit:
            self.db.sql(f"""INSERT INTO piggyvest_savings_ledger.operations
              (id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id)
              VALUES('{operation_id}','{self.intent['integrationId']}','{self.intent['merchantId']}',
                '{self.intent['customerId']}','{self.intent['goalId']}','{{}}','pvb-card:{operation_id}')""")
        self.assertIn('retired checkout credit denied', credit.exception.stderr)
        self.assert_late_receipt_is_retained_for_review(operation_id)

    def retire_with_blocked_writes(self, call, operation_id):
        process = subprocess.Popen([str(CHECKOUT.CUSTOMER.MODULE.BIN / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
            '-h', str(self.db.path), '-p', '55461', '-U', 'harness_admin', '-d', 'postgres'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.db.environment)
        try:
            process.stdin.write('BEGIN;\n' + call + ';\n\\echo RETIREMENT_HELD\n')
            process.stdin.flush()
            first = json.loads(process.stdout.readline())
            self.assertEqual(process.stdout.readline().strip(), 'RETIREMENT_HELD')
            ledger = f"""INSERT INTO piggyvest_savings_ledger.operations
              (id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id)
              VALUES('{operation_id}','{self.intent['integrationId']}','{self.intent['merchantId']}',
                '{self.intent['customerId']}','{self.intent['goalId']}','{{}}','pvb-card:{operation_id}')"""
            with ThreadPoolExecutor(max_workers=9) as pool:
                retries = [pool.submit(self.db.sql, '/* retirement-race */ ' + call) for count in range(7)]
                blocked = [pool.submit(self.db.sql, '/* retirement-race */ ' + query) for query in (
                    f"UPDATE prefunded_card.operations SET verification_fence=verification_fence+1 WHERE id='{operation_id}'", ledger)]
                deadline = time.monotonic() + 10
                waiting = 0
                try:
                    while time.monotonic() < deadline:
                        waiting = int(self.db.sql("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() "
                            "AND query LIKE '%retirement-race%' AND wait_event_type='Lock'"))
                        if waiting == 9:
                            break
                        time.sleep(0.02)
                finally:
                    process.stdin.write('COMMIT;\n\\q\n')
                    process.stdin.flush()
                self.assertEqual(waiting, 9, 'Every late write must wait while retirement is uncommitted')
                result = [first] + [json.loads(future.result(timeout=10)) for future in retries]
                for future in blocked:
                    with self.assertRaises(subprocess.CalledProcessError) as refused:
                        future.result(timeout=10)
                    self.assertIn('retired checkout', refused.exception.stderr)
                return result
        finally:
            if process.poll() is None:
                process.stdin.close()
                process.wait(timeout=10)
            if not process.stdin.closed:
                process.stdin.close()
            process.stdout.close()
            process.stderr.close()

    def assert_late_receipt_is_retained_for_review(self, operation_id):
        observation = dict(status='verified', kind='bank_inflow', references=['pvbt-' + operation_id],
                           reference='pvbt-' + operation_id, providerTransactionId='late-tx', sourceWalletId='',
                           destinationWalletId='scratch-private-wallet', destinationCustomerId='scratch-event-customer',
                           amountKobo=10000, currency='NGN')
        self.db.sql(f"""
          INSERT INTO prefunded_card.evidence_authorities VALUES('{self.intent['integrationId']}','business',
            '{self.fixture.system_identifier}','{CHECKOUT.APP}','{CHECKOUT.APP}','NGN',true);
          INSERT INTO prefunded_card.provider_evidence(integration_id,event_id,fingerprint,observation,business_id,ingestion_login)
            VALUES('{self.intent['integrationId']}','late-event','{'a' * 64}','{json.dumps(observation)}','business','{CHECKOUT.APP}');
          GRANT EXECUTE ON FUNCTION prefunded_card.classify_provider_inflow(uuid,text,text),
            prefunded_card.apply_classified_inflow(uuid,text,text) TO {CHECKOUT.APP};
        """)
        arguments = f"'{self.intent['integrationId']}','{self.fixture.system_identifier}','late-event'"
        self.assertEqual(json.loads(self.db.sql(f'SELECT prefunded_card.classify_provider_inflow({arguments})', CHECKOUT.APP)),
                         {'outcome': 'reconciliation_required'})
        self.assertEqual(self.db.sql(f'SELECT prefunded_card.apply_classified_inflow({arguments})', CHECKOUT.APP), 'reconciliation_required')
        self.assertEqual(self.db.sql('SELECT count(*) FROM prefunded_card.provider_evidence'), '1')
        self.assertEqual(self.db.sql('SELECT count(*) FROM prefunded_card.bank_projections'), '0')


if __name__ == '__main__':
    unittest.main()
