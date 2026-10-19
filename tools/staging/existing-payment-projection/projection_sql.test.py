import ast
import json
import selectors
import subprocess
import unittest

import projection_sql as subject
from pg_fixture import ProjectionHarness, ROOT


CLAIM_ARGS = 'p_integration uuid,p_business text,p_system text,p_limit integer,p_merchant uuid,p_treasury uuid'
FINISH_ARGS = 'p_operation uuid,p_token uuid,p_system text'
PROJECT_ARGS = 'p_operation uuid,p_system text'


class ProjectionSqlContractTests(unittest.TestCase):
    def test_prepared_sequence_never_commits(self):
        sequence = subject.start_sql() + subject.mutate_sql() + subject.deadline_sql()
        self.assertNotIn('COMMIT;', sequence)
        self.assertIn('BEGIN ISOLATION LEVEL READ COMMITTED;', sequence)
        self.assertIn('SET SESSION AUTHORIZATION prefunded_treasury_operator;', sequence)
        self.assertIn('SET CONSTRAINTS ALL IMMEDIATE;', sequence)

    def test_scope_equals_canonical_financial_completion_without_importing_it(self):
        source = ROOT / 'tools/staging/replay-complete-cutover-owner/financial_completion.py'
        assignments = [node for node in ast.parse(source.read_text()).body if isinstance(node, ast.Assign)]
        namespace = {'dict': dict}
        for node in assignments:
            exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), namespace)
        self.assertEqual(subject.SCOPE, namespace['SCOPE'])
        self.assertEqual(subject.TRANSFER, namespace['TRANSACTION'])

    def test_only_restricted_calls_are_three_existing_functions(self):
        restricted = subject.mutate_sql().split('SET SESSION AUTHORIZATION ')[1].split(
            'RESET SESSION AUTHORIZATION;')[0]
        self.assertNotIn('FROM prefunded_card.', restricted)
        self.assertEqual(restricted.count('prefunded_card.claim_due('), 1)
        self.assertEqual(restricted.count('prefunded_card.project('), 1)
        self.assertEqual(restricted.count('prefunded_card.finish_dispatch('), 1)
        self.assertNotIn('GRANT ', subject.start_sql() + subject.mutate_sql())


class ProjectionPostgresTests(unittest.TestCase):
    def setUp(self):
        self.database = ProjectionHarness()
        self.addCleanup(self.database.close)

    def sequence(self, ending='ROLLBACK;'):
        return self.database.generated(subject.start_sql() + subject.mutate_sql()
                                       + subject.deadline_sql()) + ending

    def refused_unchanged(self, code='42501', sequence=None):
        before = self.database.snapshot()
        result = self.database.sql(sequence or self.sequence('COMMIT;'), checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(code + ':', result.stderr)
        self.assertEqual(self.database.snapshot(), before)
        return result

    def wrap_finish(self, extra):
        self.database.sql('ALTER FUNCTION prefunded_card.finish_dispatch(uuid,uuid,text) '
                          'RENAME TO fixture_finish;')
        self.database.replace_function('finish_dispatch', FINISH_ARGS, 'boolean',
            'PERFORM prefunded_card.fixture_finish(p_operation,p_token,p_system); '
            + extra + ' RETURN true;')

    def test_successful_projection_rolls_back_every_credit_and_claim(self):
        before = self.database.snapshot()
        self.database.sql(self.sequence())
        self.assertEqual(self.database.snapshot(), before)

    def test_local_guard_uses_future_fixture_deadline_without_changing_production(self):
        generated = self.database.generated(subject.deadline_sql())
        self.assertNotIn(subject.DEADLINE, generated)
        self.assertEqual(subject.DEADLINE, '2026-10-06T15:59:10Z')
        self.assertIn(subject.DEADLINE, subject.deadline_sql())
        self.assertEqual(self.database.sql(f"SELECT '{self.database.deadline}'::timestamptz "
                                          '>clock_timestamp()').stdout.strip(), 't')

    def test_actual_deadline_guard_refuses_expired_fixture_without_mutation(self):
        guard = self.database.generated(subject.deadline_sql()).replace(
            self.database.deadline, '2000-01-01T00:00:00Z')
        result = self.refused_unchanged(sequence='BEGIN ISOLATION LEVEL READ COMMITTED; '
            'SET LOCAL standard_conforming_strings=on; ' + guard + 'ROLLBACK;')
        self.assertIn('existing payment identity or deadline refused', result.stderr)

    def test_expired_claim_is_replaced_without_manual_queue_reset(self):
        self.database.sql("UPDATE prefunded_card.dispatch_queue SET "
                          "claim_token='aaaaaaaa-0000-4000-8000-000000000002', "
                          "lease_expires_at=clock_timestamp()-interval '1 second'")
        self.database.sql(self.sequence('COMMIT;'))
        self.assertEqual(self.database.sql('SELECT attempts,claim_token IS NULL, '
                         'lease_expires_at IS NULL,finished_at IS NOT NULL '
                         'FROM prefunded_card.dispatch_queue').stdout.strip(), '5|t|t|t')

    def test_commit_is_one_credit_and_no_treasury_or_old_goal_change(self):
        before = json.loads(self.database.snapshot())
        self.database.sql(self.sequence('COMMIT;'))
        after = json.loads(self.database.snapshot())
        self.assertEqual(after['treasury'], before['treasury'])
        old = subject.SCOPE['oldGoalId']
        self.assertEqual([row for row in after['goals'] if row['id'] == old],
                         [row for row in before['goals'] if row['id'] == old])
        for key in ['projections', 'aliases', 'contributions']:
            self.assertEqual(len(after[key]), 1)
        postings = [row for row in after['postings'] if row['operation_id'] == subject.OPERATION]
        self.assertEqual({row['account']: row['amount_kobo'] for row in postings},
                         {'principal': 10000, 'internal_clearing': -10000})
        self.assertEqual(after['queue'][0]['attempts'], 5)
        self.assertIsNotNone(after['queue'][0]['finished_at'])
        self.assertIsNone(after['queue'][0]['claim_token'])
        self.assertIsNone(after['queue'][0]['lease_expires_at'])
        self.refused_unchanged()

    def test_second_candidate_even_projected_unfinished_is_rejected(self):
        self.database.sql("""INSERT INTO prefunded_card.operations
          SELECT (jsonb_populate_record(NULL::prefunded_card.operations,to_jsonb(row)||
            '{"id":"aaaaaaaa-0000-4000-8000-000000000003","idempotency_key":"second-fixture",
              "collection_reference":"second-collection","transfer_reference":"second-transfer",
              "collection_provider_transaction_id":"second-collection-id",
              "transfer_provider_transaction_id":"second-transfer-id","projection_status":"applied"}')).*
          FROM prefunded_card.operations row;
        """)
        self.refused_unchanged()

    def test_invalid_checkout_phase_rejects_before_claim(self):
        self.database.sql('ALTER TABLE prefunded_card.checkout_intents DISABLE TRIGGER USER; '
                          "UPDATE prefunded_card.checkout_intents SET phase='pending';")
        self.refused_unchanged()

    def test_missing_checkout_rejects_even_though_installed_claim_guard_admits_it(self):
        self.database.sql('ALTER TABLE prefunded_card.checkout_intents DISABLE TRIGGER USER; '
                          'DELETE FROM prefunded_card.checkout_intents;')
        self.refused_unchanged()

    def test_missing_verified_collection_rejects_before_claim(self):
        self.database.sql('ALTER TABLE prefunded_card.checkout_intents DISABLE TRIGGER USER; '
                          'UPDATE prefunded_card.checkout_intents SET verified_collection=NULL;')
        self.refused_unchanged()

    def test_active_lease_rejects_without_reset(self):
        self.database.sql("UPDATE prefunded_card.dispatch_queue SET claim_token=gen_random_uuid(), "
                          "lease_expires_at=clock_timestamp()+interval '2 minutes';")
        self.refused_unchanged()

    def test_wrong_claim_operation_rolls_back_actual_claim(self):
        self.database.sql('ALTER FUNCTION prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid) '
                          'RENAME TO fixture_claim;')
        self.database.replace_function('claim_due', CLAIM_ARGS, 'jsonb',
            'RETURN jsonb_set(prefunded_card.fixture_claim(p_integration,p_business,p_system,p_limit,'
            "p_merchant,p_treasury),'{0,operationId}',to_jsonb('wrong'::text));")
        self.refused_unchanged()

    def test_invalid_claim_shapes_and_tokens_never_project(self):
        fixtures = ['null', '{}', '[]', '[null]', '[{},{}]',
                    json.dumps([{'operationId': subject.OPERATION, 'token': None}]),
                    json.dumps([{'operationId': subject.OPERATION, 'token': 'bad'}]),
                    json.dumps([{'operationId': subject.OPERATION, 'token': 123}])]
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                self.database.replace_function('claim_due', CLAIM_ARGS, 'jsonb', f"RETURN '{fixture}'::jsonb;")
                self.refused_unchanged()

    def test_valid_but_wrong_claim_token_rejects_finish_and_rolls_back_project(self):
        self.database.sql('ALTER FUNCTION prefunded_card.claim_due(uuid,text,text,integer,uuid,uuid) '
                          'RENAME TO fixture_claim;')
        self.database.replace_function('claim_due', CLAIM_ARGS, 'jsonb',
            'RETURN jsonb_set(prefunded_card.fixture_claim(p_integration,p_business,p_system,p_limit,'
            "p_merchant,p_treasury),'{0,token}',to_jsonb(gen_random_uuid()::text));")
        self.refused_unchanged()

    def test_deferred_or_duplicate_project_rolls_back_claim(self):
        for outcome in ['deferred', 'duplicate', None]:
            with self.subTest(outcome=outcome):
                value = 'NULL' if outcome is None else f"'{outcome}'"
                self.database.replace_function('project', PROJECT_ARGS, 'text', f'RETURN {value};')
                self.refused_unchanged()

    def test_unrepaired_deferred_checker_fails_42501_and_rolls_back(self):
        self.database.sql('ALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY INVOKER;')
        result = self.refused_unchanged()
        self.assertIn('permission denied for table postings', result.stderr)

    def test_explicit_rollback_after_constraints_error_restores_root_session(self):
        self.database.sql('ALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY INVOKER;')
        before = self.database.snapshot()
        result = self.database.sql('\\set ON_ERROR_STOP off\n' + self.sequence()
                                   + 'SELECT current_user,session_user;')
        self.assertIn('42501:', result.stderr)
        self.assertEqual(result.stdout.strip(), 'postgres|postgres')
        self.assertEqual(self.database.snapshot(), before)

    def test_finish_false_rolls_back_credit_and_claim(self):
        self.database.replace_function('finish_dispatch', FINISH_ARGS, 'boolean', 'RETURN false;')
        self.refused_unchanged()

    def test_real_deferred_balance_integrity_failure_rolls_back_all(self):
        self.wrap_finish("INSERT INTO piggyvest_savings_ledger.postings(operation_id,account,amount_kobo) "
                         "VALUES(p_operation,'paid_interest',1);")
        self.refused_unchanged('23514')

    def test_entire_treasury_metadata_drift_rejects(self):
        self.wrap_finish("UPDATE prefunded_card.treasury_bindings SET verified_at=verified_at+interval '1 second';")
        self.refused_unchanged()

    def test_wrong_attempt_increment_rejects(self):
        self.wrap_finish('UPDATE prefunded_card.dispatch_queue SET attempts=attempts+1;')
        self.refused_unchanged()

    def test_false_finished_acknowledgement_rejects(self):
        self.wrap_finish('UPDATE prefunded_card.dispatch_queue SET finished_at=NULL;')
        self.refused_unchanged()

    def test_physical_identity_and_restricted_root_refuse(self):
        self.refused_unchanged(sequence=subject.start_sql())
        result = self.database.sql(self.database.generated(subject.start_sql()),
                                   login=subject.ROLE, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('42501:', result.stderr)

    def test_mutate_without_private_start_baseline_refuses(self):
        self.refused_unchanged('42P01', 'BEGIN; ' + self.database.generated(subject.mutate_sql()))

    def test_locks_block_concurrent_candidate_and_scope_changes(self):
        before = self.database.snapshot()
        process = subprocess.Popen(list(map(str, self.database.arguments())), stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env=self.database.environment, text=True)
        try:
            process.stdin.write(self.database.generated(subject.start_sql()) + "SELECT 'locked';\n")
            process.stdin.flush()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(timeout=10), 'Private PG did not acknowledge locks')
                self.assertEqual(process.stdout.readline().strip(), 'locked')
            statements = [
                'INSERT INTO prefunded_card.dispatch_queue(operation_id) VALUES(gen_random_uuid())',
                "UPDATE prefunded_card.operations SET projection_status='applied'",
                'UPDATE prefunded_card.checkout_intents SET initialization_fence=initialization_fence+1',
                'UPDATE prefunded_card.treasury_bindings SET consumed_kobo=consumed_kobo+1',
                'UPDATE public.customer_savings_goals SET current_amount=current_amount+1']
            for statement in statements:
                with self.subTest(statement=statement):
                    result = self.database.sql("BEGIN; SET LOCAL lock_timeout='100ms'; " + statement,
                                               checked=False)
                    self.assertIn('55P03:', result.stderr)
            process.stdin.write('ROLLBACK;\n')
            process.stdin.flush()
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual((process.returncode, stdout, stderr), (0, '', ''))
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=10)
        self.assertEqual(self.database.snapshot(), before)


if __name__ == '__main__':
    unittest.main()
