import unittest

from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanDatabaseFixtureTests(unittest.TestCase):
    def test_local_fixture_uses_the_exact_live_rpc_definition_and_keeps_guards_enabled(self):
        database = PlanTestDatabase()
        try:
            digest = database.query("SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname='create_customer_savings_goal'")
            self.assertEqual(digest, '54329ee7d061c76bd1e7603d8597f7ee')
            self.assertEqual(database.query("SELECT count(*) FROM pg_trigger WHERE tgenabled<>'O' AND NOT tgisinternal"), '0')
            database.query('CREATE TABLE public.synthetic_reset_marker(id integer)')
            database.reset()
            self.assertEqual(database.query("SELECT to_regclass('public.synthetic_reset_marker') IS NULL"), 't')
        finally:
            database.close()


if __name__ == '__main__':
    unittest.main()
