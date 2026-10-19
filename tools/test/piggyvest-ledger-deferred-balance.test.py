import json
import unittest

from piggyvest_ledger_balance_harness import LedgerBalanceHarness, ROOT


LOGIN = 'prefunded_treasury_operator'
SCOPE = ("'40000000-0000-4000-8000-000000000001',"
         "'10000000-0000-4000-8000-000000000001',"
         "'20000000-0000-4000-8000-000000000001',"
         "'30000000-0000-4000-8000-000000000001'")


class LedgerBalanceAssertions:
    def credit(self, suffix, ending, login=LOGIN, prefix='', scope=SCOPE):
        command = dict(operationId='60000000-0000-4000-8000-' + suffix,
                       kind='credit_principal', principalKobo=10000, interestKobo=0,
                       evidenceId='synthetic-deferred-balance-' + suffix, referenceId=None)
        return self.harness.sql(
            prefix + 'BEGIN; SELECT session_user,current_user; '
            f"SELECT piggyvest_savings_ledger.apply({scope},'{json.dumps(command)}'); "
            f'SELECT piggyvest_savings_ledger.snapshot({scope}); ' + ending,
            login=login, checked=False)

    def assert_application_recorded(self, result):
        rows = result.stdout.strip().splitlines()
        self.assertEqual(rows[0], LOGIN + '|' + LOGIN)
        self.assertEqual(json.loads(rows[1])['outcome'], 'recorded')
        self.assertEqual(json.loads(rows[2])['ledger']['confirmedPrincipalKobo'], 10000)

    def assert_no_durable_credit(self):
        self.assertEqual(self.harness.sql(
            'SELECT (SELECT count(*) FROM piggyvest_savings_ledger.operations),'
            '(SELECT count(*) FROM piggyvest_savings_ledger.postings);').stdout.strip(), '0|0')


class LedgerDeferredBalanceTests(LedgerBalanceAssertions, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.harness = LedgerBalanceHarness()
        cls.addClassCleanup(cls.harness.close)
        cls.harness.install()

    def test_baseline_matches_actual_invoker_checker_and_deferred_triggers(self):
        self.assertEqual(self.harness.sql("""
          SELECT prosecdef,pg_get_userbyid(proowner),proconfig::text,md5(prosrc),proacl::text
          FROM pg_proc WHERE oid='piggyvest_savings_ledger.check_balance()'::regprocedure;
          SELECT count(*),bool_and(tgdeferrable AND tginitdeferred AND tgenabled='O')
          FROM pg_trigger WHERE tgfoid='piggyvest_savings_ledger.check_balance()'::regprocedure;
          SELECT has_table_privilege('prefunded_treasury_operator',
            'piggyvest_savings_ledger.postings','SELECT'),
            has_table_privilege('prefunded_treasury_operator',
            'piggyvest_savings_ledger.operations','SELECT');
        """).stdout.strip().splitlines(), [
            'f|postgres|{search_path=pg_catalog}|c857aa292294e0c115a273b1db0931f0|{postgres=X/postgres}',
            '2|t', 'f|f'])

    def test_select_then_rollback_hides_commit_permission_failure(self):
        result = self.credit('000000000001', 'ROLLBACK;')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_application_recorded(result)
        self.assert_no_durable_credit()

    def test_forcing_deferred_constraints_reproduces_42501_and_rolls_back(self):
        result = self.credit('000000000002', 'SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;')
        self.assert_application_recorded(result)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('42501: permission denied for table postings', result.stderr)
        self.assertIn('check_balance()', result.stderr)
        self.assert_no_durable_credit()

    def test_balanced_two_postings_still_fail_after_restoring_restricted_commit_identity(self):
        result = self.credit('000000000004',
            'RESET SESSION AUTHORIZATION; '
            'SELECT count(*),sum(amount_kobo) FROM piggyvest_savings_ledger.postings; '
            'SET SESSION AUTHORIZATION prefunded_treasury_operator; '
            'SELECT session_user,current_user; COMMIT;',
            login='postgres', prefix='SET SESSION AUTHORIZATION prefunded_treasury_operator; ')
        self.assert_application_recorded(result)
        self.assertEqual(result.stdout.strip().splitlines()[3:], ['2|0', LOGIN + '|' + LOGIN])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('42501: permission denied for table postings', result.stderr)
        self.assert_no_durable_credit()

    def test_privileged_commit_still_rejects_missing_balancing_postings(self):
        result = self.harness.sql("""
          BEGIN;
          INSERT INTO piggyvest_savings_ledger.operations
            (id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id)
          VALUES ('60000000-0000-4000-8000-000000000005',
            '40000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001','{}','synthetic-unbalanced-control');
          COMMIT;
        """, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('23514: ledger unbalanced', result.stderr)
        self.assert_no_durable_credit()

    def test_baseline_legitimate_balanced_credit_fails_at_commit_without_select_grants(self):
        result = self.credit('000000000003', 'COMMIT;')
        self.assert_application_recorded(result)
        if result.returncode:
            self.assertIn('42501: permission denied for table postings', result.stderr)
            self.assertIn('check_balance()', result.stderr)
            self.assert_no_durable_credit()
        self.assertNotEqual(result.returncode, 0)


CANDIDATE = ROOT / 'supabase/migrations/20261003160000_piggyvest_ledger_deferred_balance_authority.sql'


class LedgerBalanceCandidateTests(LedgerBalanceAssertions, unittest.TestCase):
    def setUp(self):
        self.harness = LedgerBalanceHarness()
        self.addCleanup(self.harness.close)
        self.harness.install()

    def apply_candidate(self):
        self.harness.sql(CANDIDATE.read_text())

    def test_legitimate_balanced_restricted_credit_commits_without_select_grants(self):
        self.apply_candidate()
        result = self.credit('000000000003', 'COMMIT;')
        self.assert_application_recorded(result)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.harness.sql(
            'SELECT count(*),sum(amount_kobo) FROM piggyvest_savings_ledger.postings;'
        ).stdout.strip(), '2|0')
        self.assertEqual(self.harness.sql("""
          SELECT prosecdef,proacl::text,md5(prosrc),proconfig::text FROM pg_proc
            WHERE oid='piggyvest_savings_ledger.check_balance()'::regprocedure;
          SELECT has_function_privilege('prefunded_treasury_operator',
            'piggyvest_savings_ledger.check_balance()','EXECUTE'),
            has_table_privilege('prefunded_treasury_operator',
            'piggyvest_savings_ledger.postings','SELECT'),
            has_table_privilege('prefunded_treasury_operator',
            'piggyvest_savings_ledger.operations','SELECT');
          SELECT count(*),bool_and(tgdeferrable AND tginitdeferred AND tgenabled='O')
            FROM pg_trigger WHERE tgfoid='piggyvest_savings_ledger.check_balance()'::regprocedure;
        """).stdout.strip().splitlines(), [
            't|{postgres=X/postgres}|c857aa292294e0c115a273b1db0931f0|{search_path=pg_catalog}',
            'f|f|f', '2|t'])

    def test_candidate_still_rejects_unbalanced_commit(self):
        self.apply_candidate()
        LedgerDeferredBalanceTests.test_privileged_commit_still_rejects_missing_balancing_postings(self)

    def test_candidate_still_rejects_two_postings_with_nonzero_sum(self):
        self.apply_candidate()
        result = self.harness.sql("""
          BEGIN;
          INSERT INTO piggyvest_savings_ledger.operations
            (id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id)
          VALUES ('60000000-0000-4000-8000-000000000007',
            '40000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001','{}','synthetic-nonzero-control');
          INSERT INTO piggyvest_savings_ledger.postings VALUES
            ('60000000-0000-4000-8000-000000000007','principal',10000),
            ('60000000-0000-4000-8000-000000000007','internal_clearing',-9999);
          COMMIT;
        """, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('23514: ledger unbalanced', result.stderr)
        self.assert_no_durable_credit()

    def test_candidate_still_rejects_wrong_role_and_goal_or_integration(self):
        self.apply_candidate()
        self.harness.sql("""
          CREATE ROLE unrelated_worker LOGIN NOINHERIT;
          GRANT USAGE ON SCHEMA piggyvest_savings_ledger TO unrelated_worker;
          GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)
            TO unrelated_worker;
        """)
        for login, scope in [("unrelated_worker", SCOPE),
            (LOGIN, SCOPE.replace('30000000-0000-4000-8000-000000000001',
                                 '30000000-0000-4000-8000-000000000099')),
            (LOGIN, SCOPE.replace('40000000-0000-4000-8000-000000000001',
                                 '40000000-0000-4000-8000-000000000099')),
            (LOGIN, SCOPE.replace('10000000-0000-4000-8000-000000000001',
                                 '10000000-0000-4000-8000-000000000099')),
            (LOGIN, SCOPE.replace('20000000-0000-4000-8000-000000000001',
                                 '20000000-0000-4000-8000-000000000099'))]:
            with self.subTest(login=login, scope=scope):
                result = self.credit('000000000006', 'COMMIT;', login=login, scope=scope)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('42501:', result.stderr)
                self.assert_no_durable_credit()

    def test_candidate_refuses_drifted_checker_or_trigger_baselines(self):
        mutations = [
            "ALTER FUNCTION piggyvest_savings_ledger.check_balance() SET search_path=public;",
            "ALTER FUNCTION piggyvest_savings_ledger.check_balance() OWNER TO ledger_caller;",
            "GRANT EXECUTE ON FUNCTION piggyvest_savings_ledger.check_balance() TO PUBLIC;",
            "ALTER TABLE piggyvest_savings_ledger.postings DISABLE TRIGGER postings_balanced;",
            "ALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY DEFINER;",
            "ALTER FUNCTION piggyvest_savings_ledger.check_balance() LEAKPROOF;",
            "ALTER FUNCTION piggyvest_savings_ledger.check_balance() STABLE;",
            "ALTER FUNCTION piggyvest_savings_ledger.check_balance() PARALLEL SAFE;",
            "CREATE OR REPLACE FUNCTION piggyvest_savings_ledger.check_balance() RETURNS trigger "
            "LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RETURN NULL; END $$;",
            "DROP TRIGGER postings_balanced ON piggyvest_savings_ledger.postings; "
            "CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON piggyvest_savings_ledger.postings "
            "DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW "
            "EXECUTE FUNCTION piggyvest_savings_ledger.check_balance();",
            "CREATE CONSTRAINT TRIGGER extra_balanced AFTER INSERT ON piggyvest_savings_ledger.postings "
            "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW "
            "EXECUTE FUNCTION piggyvest_savings_ledger.check_balance();",
            "DROP TRIGGER postings_balanced ON piggyvest_savings_ledger.postings; "
            "CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON piggyvest_savings_ledger.postings "
            "FROM piggyvest_savings_ledger.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW "
            "EXECUTE FUNCTION piggyvest_savings_ledger.check_balance();",
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                source = CANDIDATE.read_text()
                self.assertTrue(source.startswith('BEGIN;'))
                result = self.harness.sql('BEGIN; ' + mutation + source[len('BEGIN;'):], checked=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('42501: ledger balance authority baseline refused', result.stderr)
        LedgerDeferredBalanceTests.test_baseline_matches_actual_invoker_checker_and_deferred_triggers(self)


if __name__ == '__main__':
    unittest.main()
