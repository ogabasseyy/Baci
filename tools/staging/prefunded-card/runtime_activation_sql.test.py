import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import runtime_activation_sql as renderer


HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('enrollment', HERE / 'enrollment-owner-candidate.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


def baseline_sources(sources):
    customer, checkout, promotion = sources
    customer = customer.replace('DECLARE treasury_snapshot prefunded_card.treasury_snapshots%ROWTYPE;\n', '')
    customer = customer.replace('remaining_kobo numeric; maximum_kobo numeric;', 'remaining_kobo numeric;')
    start = customer.index('  SELECT * INTO treasury_snapshot')
    customer = customer[:start] + customer[customer.index('  PERFORM route.goal_id', start):]
    start = customer.index('  maximum_kobo:=greatest')
    customer = customer[:start] + customer[customer.index('  FOR candidate IN', start):]
    customer = customer.replace("'enabled',maximum_kobo>0 AND jsonb_array_length(saved_methods)>0,",
        "'enabled',remaining_kobo>0 AND jsonb_array_length(saved_methods)>0\n"
        "      AND treasury.verified_available_kobo-treasury.reserved_kobo-treasury.consumed_kobo>0,")
    customer = customer.replace("'maximumAmountKobo',maximum_kobo", "'maximumAmountKobo',remaining_kobo")
    start = checkout.index('  IF NOT FOUND OR NOT EXISTS (')
    checkout = checkout[:start] + '  IF NOT FOUND OR EXISTS (' + checkout[checkout.index('\n    SELECT 1 FROM public.customer_saved_payment_methods', start):]
    checkout = checkout.replace("AND method.provider='paystack'\n", "AND method.provider='paystack'\n      AND method.is_active AND method.reusable\n")
    checkout = checkout.replace("intent.phase<>'completed'", "intent.phase NOT IN ('funding_pending','completed')")
    promotion = promotion.replace("  IF intent.phase='reconciliation_required' THEN\n    RETURN prefunded_card.checkout_snapshot(intent);\n  END IF;\n", '')
    promotion = promotion.replace("intent.phase NOT IN ('initializing','ready','pending')", "intent.phase NOT IN ('initializing','ready','pending','reconciliation_required')")
    return customer, checkout, promotion


class RuntimeActivationSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = FIXTURE.EnrollmentOwnerCandidate
        cls.fixture.setUpClass()
        cls.addClassCleanup(cls.fixture.tearDownClass)
        cls.fixture().run_candidate()
        cls.fixture.sql('CREATE ROLE postgres SUPERUSER; CREATE ROLE prefunded_authorizer NOLOGIN NOINHERIT')
        cls.fixture.file('checkout-storage.sql')
        cls.sources = tuple((HERE / name).read_text() for name in renderer.SOURCE_PINS)
        cls.old = baseline_sources(cls.sources)
        for source in cls.old:
            cls.fixture.sql(source)
        for signature, _oid, _baseline, _desired, reader in renderer.FUNCTIONS:
            cls.fixture.sql(f'ALTER FUNCTION {signature} OWNER TO postgres; REVOKE ALL ON FUNCTION {signature} FROM PUBLIC')
            if reader:
                cls.fixture.sql(f'SET ROLE postgres; GRANT EXECUTE ON FUNCTION {signature} TO {reader}')
        cls.rendered = renderer._render_activation_fixture(*cls.sources, system=cls.fixture.database.system)
        cls.expected_old = [item[2] for item in renderer.FUNCTIONS]
        cls.expected_new = [item[3] for item in renderer.FUNCTIONS]

    def clone(self, suffix):
        database = self.fixture.clone('activation_' + suffix)
        self.addCleanup(self.fixture.database.sql, 'DROP DATABASE ' + database)
        self.assertEqual(self.digests(database), self.expected_old)
        return database

    def metadata(self, database):
        values = ','.join(f"('{item[0]}')" for item in renderer.FUNCTIONS)
        return json.loads(self.fixture.sql(f"""SELECT json_agg(json_build_array(expected.signature,
          routine.oid,pg_get_userbyid(routine.proowner),routine.proacl,
          encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(expected.signature)),'UTF8')),'hex')))
          FROM (VALUES {values}) expected(signature) LEFT JOIN pg_proc routine
          ON routine.oid=to_regprocedure(expected.signature)""", database))

    def digests(self, database):
        return [item[-1] for item in self.metadata(database)]

    def state(self, database):
        return self.fixture.sql("""SELECT json_build_array(
          (SELECT count(*) FROM prefunded_card.credit_routes),
          (SELECT current_amount FROM public.customer_savings_goals),
          (SELECT count(*) FROM public.customer_savings_contributions),
          (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account='principal'),
          (SELECT count(*) FROM prefunded_card.bank_projections),
          (SELECT count(*) FROM prefunded_card.operations),(SELECT count(*) FROM prefunded_card.checkout_intents),
          (SELECT verified_available_kobo FROM prefunded_card.treasury_bindings),
          (SELECT reserved_kobo FROM prefunded_card.treasury_bindings),
          (SELECT consumed_kobo FROM prefunded_card.treasury_bindings));""", database)

    def run_sql(self, database, source=None):
        return subprocess.run(
            [str(FIXTURE.LEGACY.MODULE.BIN / 'psql'), '-XqAt', '-v', 'ON_ERROR_STOP=1',
             '-h', str(self.fixture.database.path), '-p', '55461', '-U', 'harness_admin', '-d', database],
            input=source or self.rendered, text=True, capture_output=True, timeout=30,
            env=self.fixture.database.environment)

    def test_measured_live_baseline_apply_and_retry_preserve_oids_owners_acls_and_all_data(self):
        database = self.clone('apply')
        metadata, state = self.metadata(database), self.state(database)
        self.assertEqual(state, '[1, 100.00, 1, 10000, 1, 0, 0, 10000, 0, 0]')
        for attempt in range(2):
            result = self.run_sql(database)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.digests(database), self.expected_new)
            self.assertEqual([item[:-1] for item in self.metadata(database)], [item[:-1] for item in metadata])
            self.assertEqual(self.state(database), state)

    def test_rehearsal_executes_replacements_but_rolls_back_every_definition_and_data(self):
        database = self.clone('rehearsal')
        metadata, state = self.metadata(database), self.state(database)
        source = renderer._render_activation_fixture(*self.sources, system=self.fixture.database.system, rehearsal=True)
        self.assertEqual(source, self.rendered.removesuffix('COMMIT;\n') + 'ROLLBACK;\n')
        result = self.run_sql(database, source)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_accepts_partial_exact_update_without_adopting_foreign_definition(self):
        database = self.clone('partial')
        self.fixture.sql(self.sources[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'), database)
        result = self.run_sql(database)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.digests(database), self.expected_new)

    def test_foreign_body_missing_function_owner_acl_security_and_search_path_are_refused(self):
        signature = renderer.FUNCTIONS[0][0]
        body = self.old[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace('BEGIN\n  IF', 'BEGIN\n  PERFORM 1;\n  IF')
        for index, mutation in enumerate((body, f'DROP FUNCTION {signature}',
            f'ALTER FUNCTION {signature} OWNER TO prefunded_evidence',
            f'GRANT EXECUTE ON FUNCTION {signature} TO PUBLIC',
            f'ALTER FUNCTION {signature} SECURITY INVOKER', f'ALTER FUNCTION {signature} SET search_path=public')):
            with self.subTest(mutation=index):
                database = self.clone('foreign' + str(index))
                self.fixture.sql(mutation, database)
                metadata, state = self.metadata(database), self.state(database)
                for source in (self.rendered, self.rendered.removesuffix('COMMIT;\n') + 'ROLLBACK;\n'):
                    result = self.run_sql(database, source)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('activation function baseline refused', result.stderr)
                    self.assertEqual(self.metadata(database), metadata)
                    self.assertEqual(self.state(database), state)

    def test_scope_history_budget_and_route_drift_are_refused_without_replacements(self):
        mutations = (
            'UPDATE piggyvest_staging.integrations SET enabled=false',
            'DELETE FROM prefunded_card.credit_routes',
            "UPDATE prefunded_card.credit_routes SET system_identifier='1'",
            'UPDATE public.customer_savings_goals SET current_amount=101',
            'UPDATE prefunded_card.treasury_bindings SET reserved_kobo=1',
            'UPDATE prefunded_card.treasury_bindings SET consumed_kobo=1',
            'UPDATE prefunded_card.treasury_identities SET opening_available_kobo=10001',
            "UPDATE prefunded_card.bank_projections SET event_id='foreign'",
            'UPDATE piggyvest_savings_ledger.postings SET amount_kobo=amount_kobo+1',
        )
        for index, mutation in enumerate(mutations):
            with self.subTest(mutation=index):
                database = self.clone('scope' + str(index))
                self.fixture.sql('SET session_replication_role=replica; ' + mutation, database)
                metadata, state = self.metadata(database), self.state(database)
                result = self.run_sql(database)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('activation scope refused', result.stderr)
                self.assertEqual(self.metadata(database), metadata)
                self.assertEqual(self.state(database), state)

    def test_postflight_acl_failure_rolls_back_all_prior_function_replacements(self):
        database = self.clone('postflight')
        metadata, state = self.metadata(database), self.state(database)
        signature = renderer.FUNCTIONS[0][0]
        self.fixture.sql(f"""CREATE FUNCTION public.fail_activation() RETURNS event_trigger LANGUAGE plpgsql AS $$
          BEGIN GRANT EXECUTE ON FUNCTION {signature} TO PUBLIC; END $$;
          CREATE EVENT TRIGGER fail_activation ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
          EXECUTE FUNCTION public.fail_activation();""", database)
        result = self.run_sql(database)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation function postflight refused', result.stderr)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_postflight_budget_drift_rolls_back_definitions_and_financial_change(self):
        database = self.clone('budget_late')
        metadata, state = self.metadata(database), self.state(database)
        self.fixture.sql("""CREATE FUNCTION public.fail_activation() RETURNS event_trigger LANGUAGE plpgsql AS $$
          BEGIN UPDATE prefunded_card.treasury_bindings SET reserved_kobo=1; END $$;
          CREATE EVENT TRIGGER fail_activation ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
          EXECUTE FUNCTION public.fail_activation();""", database)
        result = self.run_sql(database)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation scope refused', result.stderr)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_any_existing_card_operation_refuses_activation_even_with_zero_reservation(self):
        database = self.clone('operation')
        self.fixture.sql(f"""SET session_replication_role=replica;
          INSERT INTO prefunded_card.operations(id,integration_id,merchant_id,customer_id,goal_id,
          treasury_binding_id,request_fingerprint,idempotency_key,saved_method_id,amount_kobo,fee_allowance_kobo,
          currency,collection_reference,transfer_reference,destination_wallet_id,destination_customer_id)
          VALUES('77777777-7777-4777-8777-777777777777','{FIXTURE.LEGACY.INTEGRATION}',
          '{FIXTURE.LEGACY.MERCHANT}','{FIXTURE.LEGACY.CUSTOMER}','{FIXTURE.LEGACY.GOAL}',
          '{FIXTURE.TREASURY}','synthetic-pending','synthetic-pending','66666666-6666-4666-8666-666666666666',
          1,0,'NGN','synthetic-collection','synthetic-transfer','scratch-private-wallet','scratch-event-customer');""", database)
        metadata, state = self.metadata(database), self.state(database)
        result = self.run_sql(database)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation scope refused', result.stderr)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_public_renderer_cannot_target_scratch_and_expired_fixture_refuses(self):
        database = self.clone('target')
        for rehearsal in (False, True):
            result = self.run_sql(database, renderer.render_activation(*self.sources, rehearsal=rehearsal))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('activation owner scope refused', result.stderr)
        with patch.object(renderer, 'DEADLINE_EPOCH', 0):
            expired = renderer._render_activation_fixture(*self.sources, system=self.fixture.database.system)
        self.assertIn('activation lease expired', self.run_sql(database, expired).stderr)
        self.assertEqual(self.digests(database), self.expected_old)

    def test_existing_checkout_intent_is_refused_independently_of_operation_count(self):
        database = self.clone('intent')
        identifier = '88888888-8888-4888-8888-888888888888'
        row = dict(id=identifier, operation_id=identifier, deployment='staging',
            integration_id=FIXTURE.LEGACY.INTEGRATION, merchant_id=FIXTURE.LEGACY.MERCHANT,
            customer_id=FIXTURE.LEGACY.CUSTOMER, actor_id=FIXTURE.LEGACY.CUSTOMER, goal_id=FIXTURE.LEGACY.GOAL,
            treasury_binding_id=FIXTURE.TREASURY, business_id='business', system_identifier=self.fixture.database.system,
            expires_at='2026-09-29T15:59:10Z', database_name=database, authorized_login='prefunded_treasury_operator',
            email='synthetic@example.test', amount_kobo=1, currency='NGN', idempotency_key=identifier,
            idempotency_hash='a' * 64, request_fingerprint='b' * 64, reference='pvb-first-' + identifier,
            transfer_reference='pvbt-' + identifier, prepared_saved_method_id=identifier,
            consent_version='prefunded-first-card-v1', consent_one_time_charge=True, consent_save_card=True)
        values = ','.join("'" + str(value).replace("'", "''") + "'" for value in row.values())
        self.fixture.sql('SET session_replication_role=replica; INSERT INTO prefunded_card.checkout_intents ('
                         + ','.join(row) + ') VALUES (' + values + ')', database)
        metadata, state = self.metadata(database), self.state(database)
        self.assertEqual(self.fixture.sql('SELECT count(*) FROM prefunded_card.operations', database), '0')
        result = self.run_sql(database)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation scope refused', result.stderr)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_lease_expiry_at_postflight_rolls_back_all_replacements(self):
        database = self.clone('late_expiry')
        metadata, state = self.metadata(database), self.state(database)
        before, after = self.rendered.rsplit(f'to_timestamp({renderer.DEADLINE_EPOCH})', 1)
        result = self.run_sql(database, before + 'to_timestamp(0)' + after)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('activation lease expired', result.stderr)
        self.assertEqual(self.metadata(database), metadata)
        self.assertEqual(self.state(database), state)

    def test_sources_and_boolean_rehearsal_are_pinned_without_runtime_scope_override(self):
        for index in range(3):
            for invalid in (self.sources[index] + '\n', None, {}, b'not-source'):
                changed = list(self.sources)
                changed[index] = invalid
                with self.assertRaises(ValueError):
                    renderer.render_activation(*changed)
        for value in (None, 0, 1, 'false'):
            with self.assertRaises(ValueError):
                renderer.render_activation(*self.sources, rehearsal=value)
        with self.assertRaises(TypeError):
            renderer.render_activation(*self.sources, system=self.fixture.database.system)


if __name__ == '__main__':
    unittest.main()
