import subprocess
import unittest

from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def assert_trigger_refuses(self, mutation, deferred, message):
        self.database.query("""
          CREATE FUNCTION public.synthetic_candidate_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
        """ + mutation + """
            RETURN NEW;
          END $$;
        """)
        trigger = ('CREATE CONSTRAINT TRIGGER synthetic_candidate_mutation AFTER INSERT '
                   'ON piggyvest_savings_ledger.bindings DEFERRABLE INITIALLY DEFERRED '
                   if deferred else 'CREATE TRIGGER synthetic_candidate_mutation AFTER INSERT '
                   'ON piggyvest_savings_ledger.bindings ')
        self.database.query(trigger + 'FOR EACH ROW EXECUTE FUNCTION public.synthetic_candidate_mutation()')
        payload = self.database.payload(goal_only=True)
        before = self.database.inventory()
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('goal-apply', payload))
        self.assertIn(message, caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')
        self.assertEqual(self.database.query('SELECT count(*) FROM piggyvest_savings_ledger.bindings'), '1')
        self.assertEqual(before['stateMd5'], self.database.inventory()['stateMd5'])

    def test_immediate_binding_trigger_cannot_change_candidate_principal_after_goal_validation(self):
        self.assert_trigger_refuses('UPDATE public.customer_savings_goals SET current_amount=1 '
            'WHERE id=NEW.goal_id;', False, 'candidate changed')

    def test_deferred_binding_trigger_cannot_replace_genuine_candidate_consent(self):
        self.assert_trigger_refuses("UPDATE public.customer_savings_goals SET terms_accepted_at='2026-10-01T00:00:00Z' "
            'WHERE id=NEW.goal_id;', True, 'candidate changed')

    def test_deferred_binding_trigger_cannot_disable_exact_candidate_binding(self):
        self.assert_trigger_refuses('UPDATE piggyvest_savings_ledger.bindings SET enabled=false '
            'WHERE goal_id=NEW.goal_id;', True, 'immutable binding conflict')

    def test_deferred_binding_trigger_cannot_rewrite_candidate_audit_identity(self):
        self.assert_trigger_refuses("UPDATE public.customer_savings_events SET actor_type='system' "
            'WHERE goal_id=NEW.goal_id;', True, 'candidate changed')


if __name__ == '__main__':
    unittest.main()
