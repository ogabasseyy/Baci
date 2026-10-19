import importlib.util
import json
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CHECKOUT = load_module('transaction_checkout_harness', ROOT / 'tools/test/prefunded-card-checkout.test.py')
TREASURY = '50000000-0000-4000-8000-0000000000fd'
SOURCE = 'transaction-fixture-treasury'
EMAIL = 'transaction-fixture@example.com'
OPENING = '70000000-0000-4000-8000-0000000000fd'


class CheckoutRetirementTransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        CHECKOUT.PrefundedFirstCardCheckout.setUpClass()
        cls.addClassCleanup(CHECKOUT.PrefundedFirstCardCheckout.tearDownClass)
        cls.fixture = CHECKOUT.PrefundedFirstCardCheckout()
        cls.db = cls.fixture.harness
        cls.scope = {**cls.fixture.scope(), 'treasuryBindingId': TREASURY}
        for filename in ('evidence-storage.sql', 'evidence-projection-storage.sql', 'evidence-inflow.sql',
                         'evidence-projection.sql', 'evidence-conflict.sql', 'reversal-storage.sql',
                         'reversal-functions.sql', 'customer-capability.sql'):
            cls.db.file(HERE / filename)
        cls.prepare_scope()
        snapshot = cls.fixture.execute('checkout_reserve', cls.scope, cls.fixture.request())
        cls.intent = snapshot['intent']
        selection = {key: cls.intent[key] for key in ('intentId', 'customerId', 'actorId', 'goalId')}
        claim = cls.fixture.execute('checkout_claim_initialization', cls.scope, selection, user=CHECKOUT.VERIFIER)
        cls.fixture.execute('checkout_mark_initialization_uncertain', cls.scope, selection, claim, user=CHECKOUT.VERIFIER)
        cls.db.sql(f"UPDATE public.customers SET email='{EMAIL}' WHERE id='{cls.intent['customerId']}'")
        cls.prepare_contract()

    @classmethod
    def prepare_scope(cls):
        scope = cls.scope
        cls.db.sql(f"SELECT prefunded_card.provision_treasury_identity('{TREASURY}',"
                   f"'{scope['integrationId']}','{scope['merchantId']}','business','{SOURCE}','{CHECKOUT.APP}',10000)",
                   'treasury_owner')
        cls.db.sql(f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}',"
                   "'transaction-opening',1,clock_timestamp(),10000)", 'treasury_verifier')
        cls.db.sql(f"GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO {CHECKOUT.APP}; "
                   "GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) "
                   f"TO {CHECKOUT.APP}")
        opening = dict(operationId=OPENING, kind='credit_principal', principalKobo=10000,
                       interestKobo=0, evidenceId='transaction-opening', referenceId=None)
        cls.db.sql(f"SELECT piggyvest_savings_ledger.apply('{scope['integrationId']}','{scope['merchantId']}',"
                   f"'{cls.fixture.module.CUSTOMER}','{cls.fixture.module.GOAL}','{json.dumps(opening)}')", CHECKOUT.APP)
        cls.db.sql("REVOKE EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) "
                   f"FROM {CHECKOUT.APP}; REVOKE USAGE ON SCHEMA piggyvest_savings_ledger FROM {CHECKOUT.APP}; "
                   f"UPDATE public.customer_savings_goals SET current_amount=100 WHERE id='{cls.fixture.module.GOAL}'")

    @classmethod
    def prepare_contract(cls):
        import phone_email_contract
        import treasury_owner_contract

        with patch.multiple(phone_email_contract, ACTOR=CHECKOUT.ACTOR, CUSTOMER=cls.intent['customerId'],
                            GOAL=cls.intent['goalId'], EMAIL=EMAIL), patch.multiple(
                treasury_owner_contract, BUSINESS='business', INTEGRATION=cls.scope['integrationId'],
                MERCHANT=cls.scope['merchantId'], SOURCE=SOURCE, SYSTEM=cls.scope['systemIdentifier'], TREASURY=TREASURY):
            cls.contract = load_module('scratch_retirement_contract', HERE / 'checkout_retirement_contract.py')
        original_intent = cls.contract.INTENT
        cls.contract.INTENT = cls.intent['intentId']
        cls.contract.REFERENCE = cls.intent['reference']
        cls.contract.JOINS = cls.contract.JOINS.replace(original_intent, cls.intent['intentId'])
        cls.contract.render_patches = partial(cls.contract.render_patches, owner='harness_admin')

    def query(self, sql):
        arguments = [CHECKOUT.CUSTOMER.MODULE.BIN / 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
                     '-h', self.db.path, '-p', '55461', '-U', 'harness_admin', '-d', 'postgres', '-c', sql]
        try:
            return self.db.shell(arguments).stdout.strip()
        except subprocess.CalledProcessError as error:
            error.cmd = 'scratch retirement transaction'
            raise

    def snapshot(self):
        return json.loads(self.query(self.contract.snapshot_sql()))

    def persisted_state(self):
        return json.loads(self.query("""SELECT jsonb_build_object(
          'operations',(SELECT jsonb_agg(to_jsonb(operation) ORDER BY id) FROM prefunded_card.operations operation),
          'intents',(SELECT jsonb_agg(to_jsonb(intent) ORDER BY id) FROM prefunded_card.checkout_intents intent),
          'queue',(SELECT jsonb_agg(to_jsonb(queue) ORDER BY operation_id) FROM prefunded_card.dispatch_queue queue),
          'retirementTable',to_regclass('prefunded_card.checkout_retirements'),
          'retiredColumn',EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='prefunded_card.operations'::regclass
            AND attname='checkout_retired' AND NOT attisdropped),
          'functions',(SELECT jsonb_agg(jsonb_build_object('oid',routine.oid,'body',md5(pg_get_functiondef(routine.oid)),
            'owner',routine.proowner,'acl',routine.proacl) ORDER BY routine.oid)
            FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=routine.pronamespace
            WHERE namespace.nspname='prefunded_card'))"""))

    def render(self, report, rehearsal=False):
        evidence = dict(providerResult='transaction_not_found', providerHttp=400,
                        verifiedAt=datetime.now(timezone.utc).isoformat(), configurationSha256='a' * 64,
                        operatorApproval='retire-unconfirmed-test-checkout-v1')
        sql = self.contract.render_transaction(HERE, report, evidence, rehearsal=rehearsal)
        self.assertEqual(sql.count("session_user<>'postgres'"), 1)
        return sql.replace("session_user<>'postgres'", "session_user<>'harness_admin'", 1)

    def test_full_transaction_rehearsal_rolls_back_then_commit_preserves_principal(self):
        before = self.snapshot()
        self.contract.validate(before)
        self.assertEqual(before['principalKobo'], 10000)
        self.assertEqual(before['reservedKobo'], 10000)
        persisted = self.persisted_state()
        self.assertIsNone(persisted['retirementTable'])
        self.assertFalse(persisted['retiredColumn'])
        expected = dict(status='retired_unconfirmed', intentId=self.intent['intentId'], releasedKobo=10000)

        self.assertEqual(json.loads(self.query(self.render(before, rehearsal=True))), expected)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.persisted_state(), persisted)

        stale = {**before, 'protected': 'b' * 64}
        with self.assertRaises(subprocess.CalledProcessError) as refused:
            self.query(self.render(stale))
        self.assertIn('retirement baseline changed', refused.exception.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.persisted_state(), persisted)

        self.assertEqual(json.loads(self.query(self.render(before))), expected)
        after = self.snapshot()
        self.contract.validate(after, retired=True)
        self.assertEqual(after['protected'], before['protected'])
        self.assertEqual(after['principalKobo'], 10000)
        self.assertEqual(after['reservedKobo'], 0)
        self.assertEqual(after['consumedKobo'], 0)
        recorded = self.persisted_state()
        self.assertTrue(recorded['retiredColumn'])
        self.assertEqual(recorded['retirementTable'], 'prefunded_card.checkout_retirements')
        self.assertEqual(recorded['operations'], [{**persisted['operations'][0], 'checkout_retired': True}])
        self.assertEqual(recorded['intents'], [{**persisted['intents'][0], 'phase': 'retired_unconfirmed'}])
        self.assertIsNotNone(recorded['queue'][0]['finished_at'])
        self.assertEqual(self.query('SELECT count(*) FROM prefunded_card.checkout_retirements'), '1')
        self.assertEqual(self.query("SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings "
                                    "WHERE account='principal'"), '10000')


if __name__ == '__main__':
    unittest.main()
