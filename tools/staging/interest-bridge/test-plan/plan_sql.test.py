import unittest

from plan_sql import build_sql


class PlanSqlTests(unittest.TestCase):
    def test_only_explicit_apply_commits_and_inventory_is_read_only(self):
        self.assertTrue(build_sql('inventory').endswith('ROLLBACK;\n'))
        self.assertIn('SET TRANSACTION READ ONLY;', build_sql('inventory'))
        self.assertTrue(build_sql('rehearse', {}).endswith('ROLLBACK;\n'))
        self.assertTrue(build_sql('apply', {}).endswith('COMMIT;\n'))
        for mode in ('inventory', 'rehearse', 'apply'):
            sql = build_sql(mode, {})
            for forbidden in ('DISABLE TRIGGER', 'session_replication_role', 'ALTER ROLE',
                              'UPDATE piggyvest_staging.wallet_goal_mappings', 'CREATE ROLE', 'GRANT '):
                self.assertNotIn(forbidden, sql)

    def test_json_literals_do_not_escape_into_sql_commands(self):
        sql = build_sql('rehearse', {'reference': "proof'; SELECT forbidden_write(); --"})
        self.assertIn("proof''; SELECT forbidden_write(); --", sql)
        self.assertTrue(sql.endswith('ROLLBACK;\n'))

    def test_unrecognized_execution_mode_is_refused(self):
        with self.assertRaises(ValueError):
            build_sql('commit-all')
        with self.assertRaises(ValueError):
            build_sql('apply', None)

    def test_goal_only_modes_commit_only_on_apply_and_cannot_swap_policy_scope(self):
        self.assertTrue(build_sql('goal-rehearse', {'goalOnly': True}).endswith('ROLLBACK;\n'))
        self.assertTrue(build_sql('goal-apply', {'goalOnly': True}).endswith('COMMIT;\n'))
        for mode, payload in (('goal-apply', {}), ('apply', {'goalOnly': True}),
                              ('goal-rehearse', {'goalOnly': 1})):
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, 'execution-policy-scope'):
                build_sql(mode, payload)


if __name__ == '__main__':
    unittest.main()
