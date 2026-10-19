import importlib.util
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'prefunded_card_customer_harness',
    Path(__file__).with_name('prefunded-card-customer.test.py'),
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('prefunded customer harness unavailable')
CUSTOMER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CUSTOMER)

APP = 'prefunded_treasury_operator'
VERIFIER = 'prefunded_authorizer'
ACTOR = CUSTOMER.ACTOR
TREASURY = '50000000-0000-4000-8000-0000000000fc'


class PrefundedFirstCardCheckout(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = CUSTOMER.MODULE
        cls.harness = cls.module.PrefundedProjection
        cls.harness.setUpClass()
        cls.system_identifier = str(cls.harness.system)
        try:
            cls.harness.file('tools/staging/prefunded-card/customer-authorization-fixture.sql')
            for name in ['authorization-storage.sql', 'authorization-candidate.sql',
                         'authorization-functions.sql', 'dispatch-queue.sql']:
                cls.harness.file(f'tools/staging/prefunded-card/{name}')
            cls.harness.sql(f"""
              DO $$
              BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{APP}') THEN
                  CREATE ROLE {APP} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{VERIFIER}') THEN
                  CREATE ROLE {VERIFIER} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
                END IF;
              END $$;
              GRANT prefunded_treasury_ledger_worker,prefunded_card_authorization_reader TO {APP};
              GRANT prefunded_card_authorization_provisioner TO {VERIFIER};
              ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email text;
              ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS user_id uuid;
              ALTER TABLE public.customer_saved_payment_methods
                ADD COLUMN IF NOT EXISTS exp_month text,
                ADD COLUMN IF NOT EXISTS exp_year text,
                ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
              DO $$
              BEGIN
                IF NOT EXISTS (
                  SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.customer_saved_payment_methods'::regclass
                    AND conname='customer_saved_payment_method_customer_id_provider_authoriz_key'
                ) THEN
                  ALTER TABLE public.customer_saved_payment_methods
                    ADD CONSTRAINT customer_saved_payment_method_customer_id_provider_authoriz_key
                    UNIQUE(customer_id,provider,authorization_signature);
                END IF;
              END $$;
              INSERT INTO piggyvest_savings_ledger.bindings
                (goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled)
              VALUES('{cls.module.GOAL}','{cls.module.INTEGRATION}','{cls.module.MERCHANT}',
                '{cls.module.CUSTOMER}','{APP}',true);
              INSERT INTO prefunded_card.credit_routes(goal_id,integration_id,merchant_id,customer_id,system_identifier,created_at)
              VALUES('{cls.module.GOAL}','{cls.module.INTEGRATION}','{cls.module.MERCHANT}',
                '{cls.module.CUSTOMER}','{cls.system_identifier}',clock_timestamp());
              UPDATE public.customers SET email='first-card@example.test',user_id='{ACTOR}'
                WHERE id='{cls.module.CUSTOMER}';
              DELETE FROM public.customer_saved_payment_methods
                WHERE customer_id='{cls.module.CUSTOMER}' AND provider='paystack';
            """)
            cls.harness.file('tools/staging/prefunded-card/checkout-storage.sql')
            cls.harness.file('tools/staging/prefunded-card/checkout-reserve.sql')
            cls.harness.file('tools/staging/prefunded-card/checkout-capability.sql')
            cls.harness.file('tools/staging/prefunded-card/checkout-initialization.sql')
            cls.harness.file('tools/staging/prefunded-card/checkout-promotion.sql')
            cls.harness.file('tools/staging/prefunded-card/checkout-roles.sql')
            cls.harness.sql(
                f"GRANT USAGE ON SCHEMA prefunded_card TO {APP},{VERIFIER},treasury_owner; "
                "GRANT EXECUTE ON FUNCTION "
                "prefunded_card.provision_treasury_identity(uuid,uuid,uuid,text,text,name,bigint) "
                "TO treasury_owner; "
                "GRANT USAGE ON SCHEMA prefunded_card TO treasury_verifier; "
                "GRANT EXECUTE ON FUNCTION "
                "prefunded_card.record_treasury_snapshot(uuid,text,bigint,timestamptz,bigint) "
                "TO treasury_verifier; "
                "GRANT EXECUTE ON FUNCTION "
                "prefunded_card.read_authorization(uuid,uuid,uuid,uuid,uuid,text), "
                "prefunded_card.claim_collection(uuid,bigint) "
                f"TO {APP};"
            )
            cls.harness.sql(
                f"SELECT prefunded_card.provision_treasury_identity('{TREASURY}',"
                f"'{cls.module.INTEGRATION}','{cls.module.MERCHANT}','business',"
                f"'first-card-treasury','{APP}',50000)",
                'treasury_owner',
            )
            cls.harness.sql(
                f"SELECT prefunded_card.record_treasury_snapshot('{TREASURY}',"
                "'first-card-opening',1,clock_timestamp(),50000)",
                'treasury_verifier',
            )
        except Exception:
            cls.harness.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.harness.tearDownClass()

    def scope(self, system_identifier=None):
        return {
            'deployment': 'staging',
            'integrationId': self.module.INTEGRATION,
            'merchantId': self.module.MERCHANT,
            'treasuryBindingId': TREASURY,
            'businessId': 'business',
            'systemIdentifier': system_identifier or self.system_identifier,
            'expiresAt': '2026-09-29T15:59:10Z',
        }

    def request(self, idempotency_key='80000000-0000-4000-8000-0000000000fc'):
        return {
            'customerId': self.module.CUSTOMER,
            'actorId': ACTOR,
            'goalId': self.module.GOAL,
            'amountKobo': 10000,
            'idempotencyKey': idempotency_key,
            'consent': {
                'version': 'prefunded-first-card-v1',
                'oneTimeCharge': True,
                'saveCard': True,
            },
        }

    def execute(self, function, *arguments, user=APP):
        values = ','.join(f"'{json.dumps(argument)}'::jsonb" for argument in arguments)
        return json.loads(self.harness.sql(
            f'SELECT prefunded_card.{function}({values})', user
        ))

    def capability(self, maximum_amount_kobo, customer=None, actor=None, goal=None):
        scope = json.dumps(self.scope())
        return json.loads(self.harness.sql(
            "SELECT prefunded_card.checkout_capability("
            f"'{scope}'::jsonb,'{customer or self.module.CUSTOMER}',"
            f"'{actor or ACTOR}','{goal or self.module.GOAL}',{maximum_amount_kobo})",
            APP,
        ))

    def test_00_capability_uses_live_goal_and_float_capacity_before_checkout(self):
        capability = self.capability(10000)

        self.assertEqual(capability, {
            'goalId': self.module.GOAL,
            'enabled': True,
            'maximumAmountKobo': 10000,
            'currency': 'NGN',
        })
        self.harness.file('tools/staging/prefunded-card/checkout-capability.test.sql')

    def test_01_regression_first_card_reserves_once_and_never_creates_a_placeholder_method(self):
        scope = self.scope()
        request = self.request()

        with ThreadPoolExecutor(max_workers=8) as pool:
            snapshots = list(pool.map(
                lambda _index: self.execute('checkout_reserve', scope, request),
                range(8),
            ))

        self.assertEqual(len({snapshot['intent']['intentId'] for snapshot in snapshots}), 1)
        self.assertEqual({snapshot['phase'] for snapshot in snapshots}, {'reserved'})
        self.assertEqual(self.harness.sql(
            'SELECT collection_status FROM prefunded_card.operations'
        ), 'pending')
        self.assertEqual(self.harness.sql(
            'SELECT count(*) FROM public.customer_saved_payment_methods'
        ), '0')
        self.assertEqual(self.harness.sql(
            'SELECT reserved_kobo FROM prefunded_card.treasury_bindings '
            f"WHERE id='{TREASURY}'"
        ), '10000')
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute('checkout_reserve', scope, {
                **request,
                'amountKobo': 9999,
            })
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute('checkout_reserve', scope, self.request(
                '80000000-0000-4000-8000-0000000000fd'
            ))

    def test_02_regression_concurrent_initialization_claims_do_not_reopen_post(self):
        scope = self.scope()
        selection = {
            'intentId': self.execute(
                'checkout_reserve', scope, self.request()
            )['intent']['intentId'],
            'customerId': self.module.CUSTOMER,
            'actorId': ACTOR,
            'goalId': self.module.GOAL,
        }
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(
                lambda _index: self.execute(
                    'checkout_claim_initialization', scope, selection, user=VERIFIER
                ),
                range(8),
            ))
        claims = [result for result in results if result['outcome'] == 'claimed']
        self.assertEqual(len(claims), 1)
        self.execute(
            'checkout_mark_initialization_uncertain',
            scope,
            selection,
            claims[0], user=VERIFIER,
        )
        self.assertEqual(self.execute(
            'checkout_claim_initialization', scope, selection, user=VERIFIER
        )['outcome'], 'existing')

    def test_03_regression_only_the_verifier_can_promote_once_without_a_second_charge(self):
        scope = self.scope()
        snapshot = self.execute('checkout_reserve', scope, self.request())
        intent = snapshot['intent']
        selection = {
            'intentId': intent['intentId'],
            'customerId': self.module.CUSTOMER,
            'actorId': ACTOR,
            'goalId': self.module.GOAL,
        }
        collection = {
            'intentId': intent['intentId'],
            'reference': intent['reference'],
            'providerTransactionId': '900001',
            'amountKobo': intent['amountKobo'],
            'currency': 'NGN',
            'domain': 'test',
            'authorization': {
                'authorizationCode': 'AUTH_first_card',
                'signature': 'signature-first-card',
                'customerCode': 'CUS_first_card',
                'email': 'first-card@example.test',
                'reusable': True,
                'brand': 'visa',
                'last4': '4081',
                'expiryMonth': '12',
                'expiryYear': '2030',
            },
        }
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute('checkout_promote_collection', scope, selection, collection)
        promoted = self.execute(
            'checkout_promote_collection',
            scope,
            selection,
            collection,
            user=VERIFIER,
        )
        self.assertEqual(promoted['phase'], 'funding_pending')
        self.assertEqual(self.execute(
            'checkout_promote_collection',
            scope,
            selection,
            collection,
            user=VERIFIER,
        ), promoted)
        self.assertEqual(self.harness.sql(
            'SELECT count(*) FROM public.customer_saved_payment_methods'
        ), '1')
        self.assertEqual(self.harness.sql(
            'SELECT collection_status FROM prefunded_card.operations'
        ), 'verified_success')
        method_id = self.harness.sql('SELECT id FROM public.customer_saved_payment_methods')
        card = json.loads(self.harness.sql(
            f"SELECT prefunded_card.read_authorization('{TREASURY}',"
            f"'{self.module.INTEGRATION}','{self.module.MERCHANT}',"
            f"'{self.module.CUSTOMER}','{method_id}','{self.system_identifier}')",
            APP,
        ))
        self.assertTrue(card['active'])
        self.assertTrue(card['reusable'])
        self.assertEqual(card['email'], 'first-card@example.test')
        claim = json.loads(self.harness.sql(
            f"SELECT prefunded_card.claim_collection('{intent['intentId']}',0)", APP
        ))
        self.assertEqual(claim['outcome'], 'stale_or_reconciliation_required')
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.operations'), '1')
        self.assertEqual(self.harness.sql('SELECT count(*) FROM prefunded_card.authorization_bindings'), '1')

    def test_04_regression_sql_invariants(self):
        wrong_system = '1' if self.system_identifier != '1' else '2'
        with self.assertRaises(subprocess.CalledProcessError):
            self.execute('checkout_reserve', self.scope(wrong_system), self.request())
        self.harness.file('tools/staging/prefunded-card/checkout-regressions.test.sql')
        self.harness.sql("CREATE ROLE prefunded_evidence; GRANT EXECUTE ON FUNCTION prefunded_card.checkout_reserve(jsonb,jsonb) TO prefunded_evidence; GRANT SELECT ON prefunded_card.checkout_intents TO prefunded_evidence")
        self.assertEqual(self.harness.sql("SELECT has_function_privilege('prefunded_evidence','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE') AND has_table_privilege('prefunded_evidence','prefunded_card.checkout_intents','SELECT')"), 't')
        self.harness.file('tools/staging/prefunded-card/checkout-roles.sql')
        self.assertEqual(self.harness.sql("SELECT has_function_privilege('prefunded_evidence','prefunded_card.checkout_reserve(jsonb,jsonb)','EXECUTE') OR has_table_privilege('prefunded_evidence','prefunded_card.checkout_intents','SELECT')"), 'f')

    def test_90_capability_denies_saved_cards_exhausted_float_and_wrong_owners_without_breaking_recovery(self):
        intent_id = self.harness.sql(
            'SELECT id FROM prefunded_card.checkout_intents LIMIT 1'
        )
        selection = {
            'intentId': intent_id,
            'customerId': self.module.CUSTOMER,
            'actorId': ACTOR,
            'goalId': self.module.GOAL,
        }
        self.assertFalse(self.capability(10000)['enabled'])
        self.assertEqual(
            self.execute('checkout_read', self.scope(), selection)['intent']['intentId'],
            intent_id,
        )
        self.harness.sql(
            "UPDATE public.customer_saved_payment_methods "
            "SET is_active=false,reusable=false; "
            "UPDATE prefunded_card.treasury_bindings SET verified_available_kobo=0"
        )
        self.assertFalse(self.capability(10000)['enabled'])
        self.assertFalse(self.capability(
            10000, actor='00000000-0000-4000-8000-000000000099'
        )['enabled'])

    def test_015_regression_initialization_does_not_hold_intent_while_waiting_on_treasury(self):
        spec = importlib.util.spec_from_file_location('checkout_lock_regression',
            Path(__file__).with_name('prefunded-card-checkout-locks.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        intent = self.execute('checkout_reserve', self.scope(), self.request())['intent']
        selection = {key: intent[key] for key in ('intentId', 'customerId', 'actorId', 'goalId')}
        module.assert_treasury_precedes_intent(self, self.scope(), selection)


if __name__ == '__main__':
    unittest.main()
