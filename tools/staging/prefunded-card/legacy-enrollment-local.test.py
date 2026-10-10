import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('projection_fixture', ROOT / 'tools/test/prefunded-card-projection.test.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
INTEGRATION = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2'
MERCHANT = MODULE.MERCHANT
CUSTOMER = MODULE.CUSTOMER
GOAL = MODULE.GOAL
CONTRIBUTION = '44444444-4444-4444-8444-444444444444'
LEGACY_TRANSACTION = 'legacy-eventdata-uuid'
PVB_TRANSACTION = 'pvb-single-reference-77'
EVENT = 'legacy-event'
LEGACY_DATA = 'legacy-data'
LEGACY_REFERENCE = 'legacy-reference'
LEGACY_SESSION = 'legacy-session'
LEGACY_CREDITED_AT = '2026-09-26T12:00:00Z'


class LegacyEnrollment(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = MODULE.PrefundedProjection
        cls.database.setUpClass()
        try:
            cls.database.sql('CREATE DATABASE piggyvest_legacy_enrollment_scratch TEMPLATE postgres')
            for filename in [
                'evidence-storage.sql', 'evidence-projection-storage.sql', 'evidence-conflict.sql',
                'evidence-record.sql', 'evidence-transfer.sql', 'evidence-inflow.sql',
                'evidence-projection.sql', 'evidence-legacy.sql',
            ]:
                cls.file(filename)
            cls.sql("""
              CREATE ROLE prefunded_evidence NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE;
              CREATE ROLE prefunded_treasury_operator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEROLE;
              CREATE ROLE prefunded_card_authorization_reader NOLOGIN;
              GRANT prefunded_treasury_ledger_worker TO prefunded_treasury_operator;
              GRANT prefunded_card_authorization_reader TO prefunded_treasury_operator;
              GRANT USAGE ON SCHEMA prefunded_card TO prefunded_evidence,prefunded_treasury_operator;
              GRANT EXECUTE ON FUNCTION prefunded_card.record_provider_evidence(uuid,text,jsonb) TO prefunded_evidence;
              GRANT EXECUTE ON FUNCTION prefunded_card.apply_verified_legacy_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
                TO prefunded_treasury_operator;
              GRANT EXECUTE ON FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)
                TO prefunded_treasury_operator;
              UPDATE public.customer_savings_goals SET current_amount=100,target_amount=250000
                WHERE id='33333333-3333-4333-8333-333333333333';
              INSERT INTO public.customer_savings_contributions(id,goal_id,merchant_id,customer_id,amount,
                source_type,status,processed_at,idempotency_key,metadata)
              VALUES('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',
                '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
                100,'piggyvest_inflow','completed','2026-09-26T12:00:00Z','piggyvest:legacy-eventdata-uuid',
                '{"provider":"piggyvest"}');
              INSERT INTO public.piggyvest_inflow_credits(provider_transaction_id,event_data_id,event_id,
                customer_id,wallet_id,amount_kobo,fee_kobo,reference,session_id,credited_at)
              VALUES('legacy-eventdata-uuid','legacy-data','legacy-event','scratch-event-customer',
                'scratch-private-wallet',10000,0,'legacy-reference','legacy-session','2026-09-26T12:00:00Z');
              INSERT INTO piggyvest_staging.goal_inflow_projections(provider_transaction_id,integration_id,
                provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id,contribution_id,
                event_data_id,event_id,amount_kobo,fee_kobo,reference,session_id,credited_at)
              VALUES('legacy-eventdata-uuid','d91d9e87-8e0d-44de-9b84-1e1d709633d2','scratch-private-wallet',
                'scratch-event-customer','11111111-1111-4111-8111-111111111111',
                '22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',
                '44444444-4444-4444-8444-444444444444','legacy-data','legacy-event',10000,0,
                'legacy-reference','legacy-session','2026-09-26T12:00:00Z');
            """)
        except subprocess.CalledProcessError as error:
            cls.database.tearDownClass()
            raise AssertionError(error.stderr) from error

    @classmethod
    def tearDownClass(cls):
        try:
            cls.database.sql('DROP DATABASE IF EXISTS piggyvest_legacy_enrollment_scratch_partial')
            cls.database.sql('DROP DATABASE IF EXISTS piggyvest_legacy_enrollment_scratch_crossmerchant')
            cls.database.sql('DROP DATABASE IF EXISTS piggyvest_legacy_enrollment_scratch_conflicted')
            cls.database.sql('DROP DATABASE IF EXISTS piggyvest_legacy_enrollment_scratch_rollback')
            cls.database.sql('DROP DATABASE IF EXISTS piggyvest_goal_funding_scratch')
            cls.database.sql('DROP DATABASE IF EXISTS piggyvest_legacy_enrollment_scratch')
        finally:
            cls.database.tearDownClass()

    @classmethod
    def shell(cls, arguments, check=True):
        try:
            return subprocess.run([str(value) for value in arguments], env=cls.database.environment,
                                  text=True, capture_output=True, check=check, timeout=60)
        except subprocess.CalledProcessError as error:
            raise AssertionError(error.stderr) from error

    @classmethod
    def psql(cls, database, *arguments, check=True):
        return cls.shell([MODULE.BIN / 'psql', '-X', '-w', '-qAt', '-h', cls.database.path,
                          '-p', '55461', '-U', 'harness_admin', '-d', database,
                          '-v', 'ON_ERROR_STOP=1', *arguments], check=check)

    @classmethod
    def sql(cls, query, database='piggyvest_legacy_enrollment_scratch'):
        return cls.psql(database, '-c', query).stdout.strip()

    @classmethod
    def file(cls, filename, database='piggyvest_legacy_enrollment_scratch'):
        cls.psql(database, '-f', ROOT / 'tools/staging/prefunded-card' / filename)

    def proof(self, changes=None):
        now = datetime.now(timezone.utc)
        observation = {
            'eventId': EVENT,
            'fingerprint': 'b' * 64,
            'eventType': 'bank-transfer.inflow.success',
            'eventCategory': 'inflow_transaction',
            'status': 'verified',
            'kind': 'bank_inflow',
            'providerTransactionId': PVB_TRANSACTION,
            'destinationCustomerId': 'scratch-event-customer',
            'sourceWalletId': '',
            'destinationWalletId': 'scratch-private-wallet',
            'reference': LEGACY_REFERENCE,
            'references': [LEGACY_TRANSACTION, PVB_TRANSACTION, LEGACY_REFERENCE],
            'amountKobo': 10000,
            'feeKobo': 0,
            'currency': 'NGN',
            'eventDataId': LEGACY_DATA,
            'envelopeWalletId': 'scratch-private-wallet',
            'sessionId': LEGACY_SESSION,
            'creditedAt': LEGACY_CREDITED_AT,
        }
        item = {
            'receiptId': '66666666-6666-4666-8666-666666666666',
            'payloadSha256': 'b' * 64,
            'originalPayloadIntegrity': 'aead_authenticated',
            'provenance': 'provider_reconciliation',
            'signatureStatus': 'unavailable',
            'providerReconciliation': {
                'transactionId': PVB_TRANSACTION,
                'responseSha256': 'c' * 64,
                'retrievedAt': now.isoformat(),
            },
            'legacyProviderTransactionId': LEGACY_TRANSACTION,
            'contributionId': CONTRIBUTION,
            'observation': observation,
        }
        if changes:
            for key, value in changes.items():
                item[key] = value
        return {
            'schemaVersion': 1,
            'verifiedAt': now.isoformat(),
            'scope': {
                'systemIdentifier': self.database.system,
                'integrationId': INTEGRATION,
                'businessId': 'business',
                'merchantId': MERCHANT,
                'customerId': CUSTOMER,
                'goalId': GOAL,
                'providerWalletId': 'scratch-private-wallet',
                'providerCustomerId': 'scratch-event-customer',
                'currency': 'NGN',
            },
            'credits': [item],
        }

    def run_candidate(self, proof, database='piggyvest_legacy_enrollment_scratch', check=True):
        values = {
            'legacy_enrollment_test': 'on',
            'legacy_enrollment_system': self.database.system,
            'legacy_enrollment_integration': INTEGRATION,
            'legacy_enrollment_business': 'business',
            'legacy_enrollment_merchant': MERCHANT,
            'legacy_enrollment_customer': CUSTOMER,
            'legacy_enrollment_goal': GOAL,
            'legacy_enrollment_wallet': 'scratch-private-wallet',
            'legacy_enrollment_provider_customer': 'scratch-event-customer',
            'legacy_enrollment_fail_after_seed': 'on' if proof.get('_failAfterSeed') else 'off',
            'owner_sealed_json': json.dumps(proof, separators=(',', ':')),
        }
        proof = {key: value for key, value in proof.items() if key != '_failAfterSeed'}
        values['owner_sealed_json'] = json.dumps(proof, separators=(',', ':'))
        args = [f'{key}={value}' for key, value in values.items()]
        return self.psql(database, *sum((['-v', value] for value in args), []),
                         '-f', ROOT / 'tools/staging/prefunded-card/legacy-enrollment-candidate.sql', check=check)

    def assert_refused_without_side_effects(self, proof, expected_text):
        failed = self.run_candidate(proof, check=False)
        self.assertNotEqual(failed.returncode, 0, failed.stdout)
        self.assertIn(expected_text, failed.stderr)
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.bindings'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.evidence_authorities'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.credit_routes'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.provider_evidence'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '0')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.bank_projections'), '0')
        self.assertEqual(self.sql('SELECT current_amount FROM public.customer_savings_goals'), '100.00')

    def test_reconciliation_provenance_exact_replay_and_fail_closed_cases(self):
        mismatch = self.proof()
        mismatch['credits'][0]['observation']['references'].remove(LEGACY_TRANSACTION)
        self.assert_refused_without_side_effects(mismatch, 'owner proof does not exactly match')
        invalid_proofs = [
            (self.proof({'observation': {**self.proof()['credits'][0]['observation'], 'feeKobo': 1}}),
             'owner proof does not exactly match'),
            (self.proof({'observation': {**self.proof()['credits'][0]['observation'], 'status': 'deferred'}}),
             'owner proof does not exactly match'),
            (self.proof({'payloadSha256': 'd' * 64}), 'owner proof does not exactly match'),
        ]
        null_proofs = [
            (lambda proof: proof.update({'verifiedAt': None}), 'legacy enrollment verifiedAt must be a string'),
            (lambda proof: proof.update({'schemaVersion': None}), 'legacy enrollment authority or proof scope refused'),
            (lambda proof: proof['scope'].update({'currency': None}), 'legacy enrollment authority or proof scope refused'),
            (lambda proof: proof['credits'][0].update({'payloadSha256': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0].update({'originalPayloadIntegrity': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0].update({'provenance': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0]['providerReconciliation'].update({'responseSha256': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0]['providerReconciliation'].update({'retrievedAt': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0]['observation'].update({'creditedAt': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0]['observation'].update({'eventCategory': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
            (lambda proof: proof['credits'][0]['observation'].update({'envelopeWalletId': None}),
             'legacy enrollment proof fields must be non-null strings or objects'),
        ]
        for null_proof, expected in null_proofs:
            invalid = self.proof()
            null_proof(invalid)
            self.assert_refused_without_side_effects(invalid, expected)
        wrong_scope = self.proof()
        wrong_scope['scope']['merchantId'] = '99999999-9999-4999-8999-999999999999'
        invalid_proofs.append((wrong_scope, 'legacy enrollment authority or proof scope refused'))
        for invalid, expected in invalid_proofs:
            self.assert_refused_without_side_effects(invalid, expected)

        self.database.sql('CREATE DATABASE piggyvest_legacy_enrollment_scratch_partial TEMPLATE piggyvest_legacy_enrollment_scratch')
        self.psql('piggyvest_legacy_enrollment_scratch_partial', '-c',
            f"INSERT INTO piggyvest_savings_ledger.bindings VALUES('{GOAL}','{INTEGRATION}','{MERCHANT}','{CUSTOMER}','prefunded_treasury_operator',false)")
        partial = self.run_candidate(self.proof(), database='piggyvest_legacy_enrollment_scratch_partial', check=False)
        self.assertNotEqual(partial.returncode, 0)
        self.assertIn('partial or conflicting prior legacy enrollment refused', partial.stderr)

        self.database.sql('CREATE DATABASE piggyvest_legacy_enrollment_scratch_crossmerchant TEMPLATE piggyvest_legacy_enrollment_scratch')
        self.psql('piggyvest_legacy_enrollment_scratch_crossmerchant', '-c',
            "INSERT INTO public.merchants VALUES('99999999-9999-4999-8999-999999999999'); "
            "UPDATE public.customers SET merchant_id='99999999-9999-4999-8999-999999999999'")
        crossmerchant = self.run_candidate(self.proof(), database='piggyvest_legacy_enrollment_scratch_crossmerchant', check=False)
        self.assertNotEqual(crossmerchant.returncode, 0)
        self.assertIn('legacy goal or exact mapping refused', crossmerchant.stderr)

        self.database.sql('CREATE DATABASE piggyvest_legacy_enrollment_scratch_conflicted TEMPLATE piggyvest_legacy_enrollment_scratch')
        self.psql('piggyvest_legacy_enrollment_scratch_conflicted', '-c',
            "INSERT INTO prefunded_card.evidence_authorities(integration_id,business_id,system_identifier,"
            "ingestion_login,reader_login,currency,enabled) VALUES('d91d9e87-8e0d-44de-9b84-1e1d709633d2','business',"
            "(SELECT system_identifier::text FROM pg_control_system()),'prefunded_evidence','prefunded_treasury_operator','NGN',true)")
        observation = json.dumps(self.proof()['credits'][0]['observation'], separators=(',', ':'))
        self.psql('piggyvest_legacy_enrollment_scratch_conflicted', '-c',
            "INSERT INTO prefunded_card.provider_evidence(integration_id,event_id,fingerprint,observation,business_id,ingestion_login,conflicted) "
            f"VALUES('{INTEGRATION}','{EVENT}','{'b' * 64}','{observation}'::jsonb,'business','prefunded_evidence',true)")
        conflicted = self.run_candidate(self.proof(), database='piggyvest_legacy_enrollment_scratch_conflicted', check=False)
        self.assertNotEqual(conflicted.returncode, 0)
        self.assertIn('partial or conflicting prior legacy enrollment refused', conflicted.stderr)

        self.sql("UPDATE public.customer_savings_goals SET current_amount=99.99 WHERE id='" + GOAL + "'")
        unbalanced = self.run_candidate(self.proof(), check=False)
        self.assertNotEqual(unbalanced.returncode, 0)
        self.sql("UPDATE public.customer_savings_goals SET current_amount=100 WHERE id='" + GOAL + "'")
        public_function = "'public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamptz)'::regprocedure"
        function_before = self.sql(
            f"SELECT encode(pg_catalog.sha256(convert_to(pg_catalog.pg_get_functiondef({public_function}),'UTF8')),'hex')"
        )
        self.database.sql('CREATE DATABASE piggyvest_legacy_enrollment_scratch_rollback TEMPLATE piggyvest_legacy_enrollment_scratch')
        rollback = self.run_candidate({**self.proof(), '_failAfterSeed': True},
            database='piggyvest_legacy_enrollment_scratch_rollback', check=False)
        self.assertNotEqual(rollback.returncode, 0)
        self.assertIn('legacy enrollment rehearsal rollback', rollback.stderr)
        for table in ('piggyvest_savings_ledger.bindings', 'prefunded_card.evidence_authorities',
                      'prefunded_card.provider_evidence', 'piggyvest_savings_ledger.operations',
                      'prefunded_card.bank_projections'):
            self.assertEqual(self.sql(f'SELECT count(*) FROM {table}', 'piggyvest_legacy_enrollment_scratch_rollback'), '0')
        self.run_candidate(self.proof())
        self.assertEqual(self.run_candidate(self.proof()).stdout.strip().splitlines()[-1], 'already_complete')
        self.database.sql('CREATE DATABASE piggyvest_goal_funding_scratch TEMPLATE piggyvest_legacy_enrollment_scratch')
        self.file('legacy-enrollment-regressions.test.sql', 'piggyvest_goal_funding_scratch')
        self.assertEqual(self.sql(
            f"SELECT encode(pg_catalog.sha256(convert_to(pg_catalog.pg_get_functiondef({public_function}),'UTF8')),'hex')"
        ), function_before)

        self.assertEqual(self.sql('SELECT count(*) FROM public.customer_savings_contributions'), '1')
        self.assertEqual(self.sql('SELECT count(*) FROM piggyvest_savings_ledger.operations'), '1')
        self.assertEqual(self.sql('SELECT count(*) FROM prefunded_card.bank_projections'), '1')
if __name__ == '__main__':
    unittest.main()
