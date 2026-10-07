import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier


SPEC = importlib.util.spec_from_file_location(
    'projection_harness', Path(__file__).with_name('prefunded-card-projection.test.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ACTOR = '90000000-0000-4000-8000-000000000001'


class CustomerEntry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.harness = MODULE.PrefundedProjection
        cls.harness.setUpClass()
        try:
            cls.harness.file('tools/staging/prefunded-card/customer-authorization-fixture.sql')
            for name in ['authorization-storage.sql', 'authorization-candidate.sql', 'authorization-functions.sql']:
                cls.harness.file(f'tools/staging/prefunded-card/{name}')
            cls.harness.file('tools/staging/prefunded-card/customer-consent.sql')
            cls.harness.file('tools/staging/prefunded-card/customer-entry.sql')
            cls.harness.file('tools/staging/prefunded-card/customer-capability.sql')
            cls.harness.file('tools/staging/prefunded-card/dispatch-queue.sql')
            cls.harness.sql(f"""
              ALTER TABLE public.customers ADD COLUMN user_id uuid DEFAULT '{ACTOR}';
              INSERT INTO piggyvest_savings_ledger.bindings VALUES('{MODULE.GOAL}','{MODULE.INTEGRATION}',
                '{MODULE.MERCHANT}','{MODULE.CUSTOMER}','{MODULE.WORKER}',true);
              INSERT INTO prefunded_card.credit_routes VALUES('{MODULE.GOAL}','{MODULE.INTEGRATION}',
                '{MODULE.MERCHANT}','{MODULE.CUSTOMER}','{cls.harness.system}',now());
              GRANT USAGE ON SCHEMA prefunded_card TO {MODULE.WORKER},treasury_owner,treasury_verifier;
              GRANT EXECUTE ON FUNCTION prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),
                prefunded_card.customer_status(uuid,uuid,uuid,uuid,uuid,text,text,jsonb),
                prefunded_card.customer_capabilities(uuid,uuid,uuid,uuid,uuid,text,text,jsonb) TO {MODULE.WORKER};
              GRANT EXECUTE ON FUNCTION prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid),
                prefunded_card.finish_dispatch(uuid,uuid,text) TO {MODULE.WORKER};
              GRANT EXECUTE ON FUNCTION prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) TO treasury_owner;
              GRANT EXECUTE ON FUNCTION prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint) TO treasury_verifier;
            """)
            cls.harness.sql(f"SELECT prefunded_card.provision_treasury_identity('{MODULE.TREASURY}',"
                            f"'{MODULE.INTEGRATION}','{MODULE.MERCHANT}','business','treasury-wallet','{MODULE.WORKER}',50000)", 'treasury_owner')
            cls.harness.sql(f"SELECT prefunded_card.record_treasury_snapshot('{MODULE.TREASURY}','opening',1,clock_timestamp(),50000)", 'treasury_verifier')
            cls.harness.sql(f"""
              INSERT INTO prefunded_card.authorization_bindings(treasury_binding_id,saved_method_id,integration_id,merchant_id,
                customer_id,transaction_id,provider_transaction_id,provider_reference,email,authorization_code,authorization_signature,
                paystack_customer_code,domain,reusable,authorized_login,system_identifier,database_name,provisioned_by)
              VALUES('{MODULE.TREASURY}','{MODULE.METHOD}','{MODULE.INTEGRATION}','{MODULE.MERCHANT}',
                '{MODULE.CUSTOMER}','{MODULE.METHOD}','123','fixture-card-setup','fixture@example.test','AUTH_fixture','SIG_fixture',
                'CUS_fixture','test',true,'{MODULE.WORKER}','{cls.harness.system}','postgres','harness_admin');
            """)
        except Exception as error:
            if isinstance(error, subprocess.CalledProcessError):
                print(error.stderr)
            cls.harness.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.harness.tearDownClass()

    def request(self, payload, actor=ACTOR, system=None, status=False):
        function = 'customer_status' if status else 'customer_request'
        return json.loads(self.harness.sql(
            f"SELECT prefunded_card.{function}('{MODULE.INTEGRATION}','{MODULE.MERCHANT}',"
            f"'{MODULE.CUSTOMER}','{MODULE.GOAL}','{actor}','business',"
            f"'{system or self.harness.system}','{json.dumps(payload)}')", MODULE.WORKER))

    def test_capability_and_consent_contracts(self):
        self.harness.file('tools/staging/prefunded-card/customer-consent.test.sql')
        self.harness.file('tools/staging/prefunded-card/customer-capability.test.sql')

    def test_concurrent_capability_reads_serialize_treasury_locking(self):
        barrier = Barrier(8, timeout=10)
        selection = json.dumps(dict(goalId=MODULE.GOAL))

        def read_capability(_index):
            results = []
            for _round in range(4):
                barrier.wait()
                results.append(json.loads(self.harness.sql(
                    f"SELECT prefunded_card.customer_capabilities('{MODULE.INTEGRATION}',"
                    f"'{MODULE.MERCHANT}','{MODULE.CUSTOMER}','{MODULE.GOAL}',"
                    f"'{ACTOR}','business','{self.harness.system}','{selection}')", MODULE.WORKER)))
            return results

        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = list(pool.map(read_capability, range(8)))
        results = [result for batch in batches for result in batch]
        self.assertEqual(len(results), 32)
        self.assertTrue(all(result == results[0] for result in results))
        self.assertTrue(results[0]['enabled'])
        self.assertFalse(results[0]['newCardEnabled'])
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.operations'), '0')
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.customer_consents'), '0')
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.dispatch_queue'), '0')
        self.assertEqual(self.harness.sql('SELECT reserved_kobo FROM prefunded_card.treasury_bindings'), '0')

    def test_idempotent_request_race_and_readback(self):
        payload = dict(goalId=MODULE.GOAL, savedMethodId=MODULE.METHOD,
                       idempotencyKey='80000000-0000-4000-8000-000000000001', amountKobo=10000,
                       consent=dict(version='prefunded-card-v1', oneTimeCharge=True))
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.request(payload), range(8)))
        self.assertEqual(len({item['operationId'] for item in results}), 1)
        self.assertEqual({item['status'] for item in results}, {'pending'})
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.operations'), '1')
        self.assertEqual(self.harness.sql('SELECT reserved_kobo FROM prefunded_card.treasury_bindings'), '10000')
        self.assertEqual(self.harness.sql('SELECT collection_status FROM prefunded_card.operations'), 'not_started')
        self.assertEqual(self.harness.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '0')
        self.harness.sql('UPDATE public.customer_saved_payment_methods SET is_active=false')
        with self.assertRaises(subprocess.CalledProcessError):
            self.request({**payload, 'idempotencyKey': '80000000-0000-4000-8000-000000000002'})
        self.assertEqual(self.request(payload), results[0])
        self.harness.sql('UPDATE public.customer_saved_payment_methods SET is_active=true')
        for changed in [{**payload, 'amountKobo': 9999}, {**payload, 'authorizationCode': 'untrusted'},
                        {**payload, 'amountKobo': 0}, {**payload, 'amountKobo': 1.1}]:
            with self.assertRaises(subprocess.CalledProcessError):
                self.request(changed)
        with self.assertRaises(subprocess.CalledProcessError):
            self.request(payload, actor=MODULE.MERCHANT)
        with self.assertRaises(subprocess.CalledProcessError):
            self.request(payload, system='1')
        selection = dict(goalId=MODULE.GOAL, idempotencyKey=payload['idempotencyKey'])
        self.assertEqual(self.request(selection, status=True), results[0])
        def claim_due():
            return json.loads(self.harness.sql(f"SELECT prefunded_card.claim_due('{MODULE.INTEGRATION}',"
                              f"'business','{self.harness.system}',5,'{MODULE.MERCHANT}','{MODULE.TREASURY}')", MODULE.WORKER))

        with ThreadPoolExecutor(max_workers=8) as pool:
            batches = list(pool.map(lambda _: claim_due(), range(8)))
        claims = [claim for batch in batches for claim in batch]
        self.assertEqual(len(claims), 1)
        self.assertEqual(claims[0]['operationId'], results[0]['operationId'])
        self.harness.shell([MODULE.BIN / 'pg_ctl', '-D', self.harness.path / 'data',
                            '-l', self.harness.path / 'log', '-m', 'fast', 'restart',
                            '-o', f"-k {self.harness.path} -h '' -p 55461"])
        self.assertEqual(self.request(payload), results[0])
        self.assertEqual(self.request(selection, status=True), results[0])
        self.assertEqual(claim_due(), [])
        self.harness.sql("UPDATE prefunded_card.dispatch_queue SET lease_expires_at=clock_timestamp()-interval '1 second'")
        replacement = claim_due()[0]
        self.assertNotEqual(replacement['token'], claims[0]['token'])
        for claim, expected in [(claims[0], 'f'), (replacement, 't')]:
            self.assertEqual(self.harness.sql(f"SELECT prefunded_card.finish_dispatch('{claim['operationId']}',"
                             f"'{claim['token']}','{self.harness.system}')", MODULE.WORKER), expected)
        self.assertEqual(claim_due(), [])
        for role in ['anon', 'authenticated', 'service_role']:
            self.assertEqual(self.harness.sql(f"SELECT has_function_privilege('{role}',"
                             "'prefunded_card.customer_request(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)','EXECUTE')"), 'f')
        self.assertEqual(self.harness.sql(f"SELECT has_function_privilege('{MODULE.WORKER}',"
                         "'prefunded_card.customer_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,boolean)','EXECUTE')"), 'f')
        sibling_treasury = '50000000-0000-4000-8000-000000000099'
        sibling_operation = '70000000-0000-4000-8000-000000000099'
        self.harness.sql(f"SELECT prefunded_card.provision_treasury_identity('{sibling_treasury}',"
                         f"'{MODULE.INTEGRATION}','{MODULE.MERCHANT}','business','sibling-treasury-wallet','{MODULE.WORKER}',50000)", 'treasury_owner')
        self.harness.sql(f"SELECT prefunded_card.record_treasury_snapshot('{sibling_treasury}','opening',1,clock_timestamp(),50000)", 'treasury_verifier')
        self.harness.sql(f'GRANT EXECUTE ON FUNCTION prefunded_card.reserve(jsonb) TO {MODULE.WORKER}')
        sibling_command = dict(operationId=sibling_operation,integrationId=MODULE.INTEGRATION,merchantId=MODULE.MERCHANT,
                               customerId=MODULE.CUSTOMER,goalId=MODULE.GOAL,treasuryBindingId=sibling_treasury,
                               requestFingerprint='sibling-request-fingerprint',idempotencyKey='sibling-request-key',
                               savedMethodId=MODULE.METHOD,amountKobo=100,feeAllowanceKobo=0,currency='NGN',
                               collectionReference='sibling-collection',transferReference='sibling-transfer',
                               destinationWalletId='scratch-private-wallet',destinationCustomerId='scratch-event-customer')
        self.harness.sql(f"SELECT prefunded_card.reserve('{json.dumps(sibling_command)}')", MODULE.WORKER)
        self.assertEqual(claim_due(), [])
        self.assertEqual(self.harness.sql(f"SELECT claim_token IS NULL FROM prefunded_card.dispatch_queue "
                         f"WHERE operation_id='{sibling_operation}'"), 't')
        self.assertEqual(self.harness.sql(f"SELECT collection_status FROM prefunded_card.operations "
                         f"WHERE id='{sibling_operation}'"), 'not_started')
        self.harness.sql("UPDATE prefunded_card.operations SET collection_status='reversed',transfer_status='unknown',"
                         "projection_status='reconciliation_required'; "
                         "UPDATE prefunded_card.dispatch_queue SET available_at=clock_timestamp()-interval '1 second'")
        unresolved = claim_due()[0]
        self.assertEqual(self.harness.sql(f"SELECT prefunded_card.finish_dispatch('{unresolved['operationId']}',"
                         f"'{unresolved['token']}','{self.harness.system}')", MODULE.WORKER), 't')
        self.assertEqual(self.harness.sql('SELECT bool_and(finished_at IS NULL) FROM prefunded_card.dispatch_queue'), 't')
        self.harness.sql("DROP TRIGGER prefunded_card_enqueue ON prefunded_card.operations; "
                         "DROP FUNCTION prefunded_card.enqueue_dispatch(),prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid),"
                         "prefunded_card.finish_dispatch(uuid,uuid,text); DROP TABLE prefunded_card.dispatch_queue")
        self.harness.file('tools/staging/prefunded-card/dispatch-queue.sql')
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.dispatch_queue'), '2')


if __name__ == '__main__':
    unittest.main()
