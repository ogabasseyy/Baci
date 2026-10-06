import importlib.util
import json
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
SQL = Path(__file__).with_suffix('.sql').with_name(
    '20261002160000_prefunded_first_card_claim_boundary.sql')
SPEC = importlib.util.spec_from_file_location(
    'checkout_fixture', ROOT / 'tools/test/prefunded-card-checkout.test.py')
CHECKOUT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKOUT)
OPERATION = '70000000-0000-4000-8000-000000000071'
SIGNATURES = ('claim_due(uuid,text,text,integer,uuid,uuid)',
              'claim_reconciliation(uuid,integer)')


class ClaimBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        CHECKOUT.PrefundedFirstCardCheckout.setUpClass()
        cls.addClassCleanup(CHECKOUT.PrefundedFirstCardCheckout.tearDownClass)
        cls.harness = CHECKOUT.PrefundedFirstCardCheckout.harness
        cls.module = CHECKOUT.PrefundedFirstCardCheckout.module

    def setUp(self):
        self.database = 'cb_' + self._testMethodName[:55]
        self.harness.sql(f'CREATE DATABASE "{self.database}" TEMPLATE postgres')
        self.addCleanup(lambda: self.harness.sql(f'DROP DATABASE "{self.database}"'))
        self.sql(f"""
          GRANT EXECUTE ON FUNCTION prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid),
            prefunded_card.claim_reconciliation(uuid,integer) TO {CHECKOUT.APP};
        """)
        self.before = self.catalog()
        self.original_due = self.sql("SELECT pg_get_functiondef("
            "'prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)'::regprocedure)")
        self.original_reconciliation = self.sql("SELECT pg_get_functiondef("
            "'prefunded_card.claim_reconciliation(uuid,integer)'::regprocedure)")
        self.install()

    def sql(self, statement, user='harness_admin'):
        result = subprocess.run([str(CHECKOUT.CUSTOMER.MODULE.BIN / 'psql'), '-XqAt', '-w',
            '-v', 'ON_ERROR_STOP=1', '-h', str(self.harness.path), '-p', '55461',
            '-U', user, '-d', self.database, '-c', statement], text=True,
            capture_output=True, env=self.harness.environment, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    def catalog(self):
        return json.loads(self.sql("""SELECT jsonb_object_agg(p.oid::regprocedure::text,
          jsonb_build_object('metadata',to_jsonb(p)-'prosrc','sha',
            encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')))
          FROM pg_proc p WHERE p.oid IN (
            'prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid)'::regprocedure,
            'prefunded_card.claim_reconciliation(uuid,integer)'::regprocedure)"""))

    def install(self, pins=None, database=None, system=None):
        pins = self.before if pins is None else pins
        values = {
            'database': database or self.database,
            'system': system or self.harness.system,
            'claim_due_sha256': pins['prefunded_card.' + SIGNATURES[0]]['sha'],
            'claim_reconciliation_sha256': pins['prefunded_card.' + SIGNATURES[1]]['sha'],
        }
        settings = '\n'.join(
            f"SET LOCAL prefunded_card.claim_boundary_{name}='{value}';"
            for name, value in values.items())
        return self.sql('BEGIN; ' + settings + SQL.read_text() + ' COMMIT;')

    def seed(self, phase='pending', collection='pending', transfer='not_started',
             checkout=True, operation_id=OPERATION):
        self.sql(f"""CREATE FUNCTION pg_temp.seed_operation() RETURNS void
          LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $fixture$
          INSERT INTO prefunded_card.operations(id,integration_id,merchant_id,
          customer_id,goal_id,treasury_binding_id,request_fingerprint,idempotency_key,
          saved_method_id,amount_kobo,fee_allowance_kobo,currency,collection_reference,
          transfer_reference,destination_wallet_id,destination_customer_id,collection_status,
          transfer_status,collection_provider_transaction_id)
          VALUES('{operation_id}','{self.module.INTEGRATION}','{self.module.MERCHANT}',
            '{self.module.CUSTOMER}','{self.module.GOAL}','{CHECKOUT.TREASURY}',
            repeat('a',64),'fixture-{operation_id}','{self.module.METHOD}',10000,0,'NGN',
            'pvb-first-{operation_id}','pvbt-{operation_id}','scratch-private-wallet',
            'scratch-event-customer','{collection}','{transfer}',
            CASE WHEN '{collection}'='verified_success' THEN '900001' ELSE NULL END);
          $fixture$;
          SET SESSION AUTHORIZATION {CHECKOUT.APP}; SELECT pg_temp.seed_operation();""")
        if not checkout:
            return
        verified = dict(intentId=operation_id, reference=f'pvb-first-{operation_id}',
            providerTransactionId='900001', amountKobo=10000, currency='NGN', domain='test',
            authorization=dict(authorizationCode='AUTH_fixture', signature='sig_fixture',
                customerCode='CUS_fixture', email='first-card@example.test', reusable=True,
                brand='Visa', last4='4242', expiryMonth='08', expiryYear='2030'))
        evidence = "'" + json.dumps(verified) + "'::jsonb" if phase in ('funding_pending', 'completed') else 'NULL'
        self.sql(f"""INSERT INTO prefunded_card.checkout_intents(id,operation_id,deployment,
          integration_id,merchant_id,customer_id,actor_id,goal_id,treasury_binding_id,business_id,
          system_identifier,expires_at,database_name,authorized_login,email,amount_kobo,currency,
          idempotency_key,idempotency_hash,request_fingerprint,reference,transfer_reference,
          prepared_saved_method_id,consent_version,consent_one_time_charge,consent_save_card,
          phase,verified_collection)
          SELECT id,id,'staging',integration_id,merchant_id,customer_id,'{CHECKOUT.ACTOR}',
            goal_id,treasury_binding_id,'business','{self.harness.system}',
            '2026-09-29T15:59:10Z',current_database(),'{CHECKOUT.APP}','first-card@example.test',
            amount_kobo,currency,'80000000-0000-4000-8000-000000000071',repeat('b',64),
            request_fingerprint,collection_reference,transfer_reference,saved_method_id,
            'prefunded-first-card-v1',true,true,'{phase}',{evidence}
          FROM prefunded_card.operations WHERE id='{operation_id}';""")

    def due(self):
        return json.loads(self.sql(f"SELECT prefunded_card.claim_due('{self.module.INTEGRATION}',"
            f"'business','{self.harness.system}',20,'{self.module.MERCHANT}','{CHECKOUT.TREASURY}')",
            CHECKOUT.APP))

    def reconcile(self):
        return json.loads(self.sql(
            f"SELECT prefunded_card.claim_reconciliation('{OPERATION}',60)", CHECKOUT.APP))

    def financial_state(self):
        return self.sql("""SELECT jsonb_build_object(
          'operations',(SELECT jsonb_agg(to_jsonb(row)) FROM prefunded_card.operations row),
          'intents',(SELECT jsonb_agg(to_jsonb(row)) FROM prefunded_card.checkout_intents row),
          'queue',(SELECT jsonb_agg(to_jsonb(row)) FROM prefunded_card.dispatch_queue row),
          'treasury',(SELECT jsonb_agg(to_jsonb(row)) FROM prefunded_card.treasury_bindings row),
          'goals',(SELECT jsonb_agg(to_jsonb(row)) FROM public.customer_savings_goals row),
          'ledger',(SELECT jsonb_agg(to_jsonb(row)) FROM piggyvest_savings_ledger.operations row))""")

    def test_due_excludes_unfinished_first_card_without_leases_or_attempts(self):
        for phase in ('reserved', 'initializing', 'ready', 'pending', 'reconciliation_required'):
            with self.subTest(phase=phase):
                self.sql('BEGIN; ALTER TABLE prefunded_card.checkout_intents DISABLE TRIGGER USER; '
                         'DELETE FROM prefunded_card.checkout_intents; '
                         'ALTER TABLE prefunded_card.checkout_intents ENABLE TRIGGER USER; COMMIT;')
                if phase == 'reserved':
                    self.seed(phase)
                else:
                    self.sql(f"INSERT INTO prefunded_card.checkout_intents SELECT "
                        f"(jsonb_populate_record(NULL::prefunded_card.checkout_intents,"
                        f"'{self.intent_fixture}'::jsonb||jsonb_build_object('phase','{phase}'))).*")
                self.intent_fixture = self.sql('SELECT to_jsonb(row) FROM prefunded_card.checkout_intents row')
                self.sql('UPDATE prefunded_card.dispatch_queue SET claim_token=NULL, '
                         'lease_expires_at=NULL,attempts=0')
                before = self.financial_state()
                self.assertEqual(self.due(), [])
                self.assertEqual(self.financial_state(), before)

    def test_direct_reconciliation_refuses_unpromoted_checkout_without_fence_changes(self):
        self.seed('reconciliation_required')
        before = self.financial_state()
        for _attempt in range(3):
            self.assertEqual(self.reconcile(), {'outcome': 'not_verifiable'})
        self.assertEqual(self.financial_state(), before)

    def test_funding_pending_verified_collection_remains_due(self):
        self.seed('funding_pending', collection='verified_success')
        claims = self.due()
        self.assertEqual([claim['operationId'] for claim in claims], [OPERATION])
        self.assertEqual(self.reconcile(), {'outcome': 'not_verifiable'})
        self.assertEqual(self.sql('SELECT collection_status FROM prefunded_card.operations'), 'verified_success')

    def test_promoted_transfer_verification_remains_owned_by_generic_worker(self):
        self.seed('funding_pending', collection='verified_success', transfer='pending')
        self.assertEqual([claim['operationId'] for claim in self.due()], [OPERATION])
        claim = self.reconcile()
        self.assertEqual((claim['outcome'], claim['leg']), ('verify_only', 'transfer'))
        self.assertEqual(self.reconcile(), {'outcome': 'leased'})

    def test_saved_card_collection_verification_is_unchanged(self):
        self.seed(checkout=False)
        self.assertEqual([claim['operationId'] for claim in self.due()], [OPERATION])
        claim = self.reconcile()
        self.assertEqual((claim['outcome'], claim['leg']), ('verify_only', 'collection'))

    def test_unfinished_checkout_does_not_starve_saved_card_work(self):
        self.seed('reconciliation_required')
        other = '70000000-0000-4000-8000-000000000072'
        self.seed(checkout=False, operation_id=other)
        self.assertEqual([claim['operationId'] for claim in self.due()], [other])
        self.assertEqual(self.sql(f"SELECT attempts FROM prefunded_card.dispatch_queue "
                                 f"WHERE operation_id='{OPERATION}'"), '0')

    def test_completed_checkout_still_allows_unresolved_transfer_verification(self):
        self.seed('completed', collection='verified_success', transfer='unknown')
        self.assertEqual([claim['operationId'] for claim in self.due()], [OPERATION])
        self.assertEqual(self.reconcile()['leg'], 'transfer')

    def test_existing_lease_does_not_authorize_unpromoted_checkout(self):
        self.seed('reconciliation_required')
        self.sql(f"UPDATE prefunded_card.operations SET verification_fence=138,"
                 "verification_token='80000000-0000-4000-8000-000000000073',"
                 "verification_lease_expires_at=clock_timestamp()+interval '60 seconds' "
                 f"WHERE id='{OPERATION}'")
        before = self.financial_state()
        self.assertEqual(self.reconcile(), {'outcome': 'not_verifiable'})
        self.assertEqual(self.financial_state(), before)

    def test_additive_patch_preserves_installed_retirement_guards(self):
        self.sql(f"CREATE FUNCTION prefunded_card.checkout_is_retired(p_operation uuid) "
                 "RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog "
                 f"AS $$ SELECT p_operation='{OPERATION}'::uuid $$")
        due = self.original_due.replace('AND queue.finished_at IS NULL',
            'AND NOT prefunded_card.checkout_is_retired(operation.id)\n        AND queue.finished_at IS NULL')
        reconciliation = self.original_reconciliation.replace(
            "IF operation.collection_status NOT IN ('dispatching','pending','unknown')",
            "IF prefunded_card.checkout_is_retired(operation.id) THEN "
            "RETURN jsonb_build_object('outcome','not_verifiable'); END IF;\n  "
            "IF operation.collection_status NOT IN ('dispatching','pending','unknown')")
        self.sql(due + ';' + reconciliation)
        self.before = self.catalog()
        self.install()
        self.seed('funding_pending', collection='verified_success', transfer='pending')
        self.assertEqual(self.due(), [])
        self.assertEqual(self.reconcile(), {'outcome': 'not_verifiable'})

    def test_absent_prefunded_schema_is_not_installed_or_created(self):
        self.sql('DROP SCHEMA prefunded_card CASCADE')
        self.sql(SQL.read_text())
        self.assertEqual(self.sql("SELECT to_regnamespace('prefunded_card') IS NULL"), 't')

    def test_installation_preserves_acl_identity_and_finances_and_is_idempotent(self):
        for signature, entry in self.catalog().items():
            self.assertEqual(entry['metadata'], self.before[signature]['metadata'])
        self.seed('reconciliation_required')
        before = self.financial_state()
        catalog = self.catalog()
        self.install()
        self.assertEqual(self.financial_state(), before)
        self.assertEqual(self.catalog(), catalog)

    def test_wrong_second_pin_rolls_back_first_routine(self):
        self.sql(self.original_due)
        pins = json.loads(json.dumps(self.before))
        pins['prefunded_card.' + SIGNATURES[1]]['sha'] = '0' * 64
        before = self.catalog()
        with self.assertRaisesRegex(RuntimeError, 'baseline differs|anchor differs'):
            self.install(pins)
        self.assertEqual(self.catalog(), before)

    def test_database_and_physical_identity_are_required(self):
        for values in ({'database': 'wrong_database'}, {'system': '1'}):
            with self.subTest(values=values), self.assertRaisesRegex(RuntimeError, 'identity refused'):
                self.install(**values)

    def test_reviewed_predecessor_pins_are_required(self):
        settings = f"SET LOCAL prefunded_card.claim_boundary_database='{self.database}';"
        settings += f"SET LOCAL prefunded_card.claim_boundary_system='{self.harness.system}';"
        before = self.catalog()
        with self.assertRaisesRegex(RuntimeError, 'reviewed pin required'):
            self.sql('BEGIN; ' + settings + SQL.read_text() + ' COMMIT;')
        self.assertEqual(self.catalog(), before)

    def test_ambiguous_replacement_anchor_refuses_without_catalog_changes(self):
        anchor = 'AND queue.finished_at IS NULL'
        self.sql(self.original_due.replace(anchor, anchor + ' ' + anchor))
        before = self.catalog()
        with self.assertRaisesRegex(RuntimeError, 'anchor differs'):
            self.install(before)
        self.assertEqual(self.catalog(), before)

    def test_checkout_visibility_contract_is_required(self):
        self.sql('ALTER TABLE prefunded_card.checkout_intents FORCE ROW LEVEL SECURITY')
        before = self.catalog()
        with self.assertRaisesRegex(RuntimeError, 'routine refused'):
            self.install()
        self.assertEqual(self.catalog(), before)

    def test_wrong_worker_scope_still_refuses_claims(self):
        self.seed(checkout=False)
        denied = self.sql(f"SELECT prefunded_card.claim_due('{self.module.INTEGRATION}',"
            f"'wrong-business','{self.harness.system}',20,'{self.module.MERCHANT}','{CHECKOUT.TREASURY}')",
            CHECKOUT.APP)
        self.assertEqual(json.loads(denied), [])
        self.sql('GRANT EXECUTE ON FUNCTION prefunded_card.claim_reconciliation(uuid,integer) '
                 f'TO {CHECKOUT.VERIFIER}')
        with self.assertRaisesRegex(RuntimeError, 'operation denied'):
            self.sql(f"SELECT prefunded_card.claim_reconciliation('{OPERATION}',60)", CHECKOUT.VERIFIER)


if __name__ == '__main__':
    unittest.main()
