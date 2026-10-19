import json
import subprocess
import unittest

from plan_sql import build_sql
from plan_test_database import BIN, PlanTestDatabase


@unittest.skipUnless((BIN / 'initdb').exists(), 'Local PostgreSQL 17 unavailable')
class PlanGoalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = PlanTestDatabase()
        cls.addClassCleanup(cls.database.close)

    def setUp(self):
        self.database.reset()

    def test_nullable_variant_attributes_use_the_official_empty_attributes_fallback(self):
        self.database.query("""
          INSERT INTO public.product_variants(id,product_id,merchant_id,price_override,sku)
          SELECT 'b9b9b9b9-0000-4000-8000-000000000002',id,merchant_id,1500,'synthetic-sku' FROM public.products;
          UPDATE public.customer_savings_goals SET variant_id='b9b9b9b9-0000-4000-8000-000000000002';
        """)
        payload = self.database.payload()
        result = json.loads(self.database.query(build_sql('apply', payload)))
        snapshot = json.loads(self.database.query("SELECT product_snapshot FROM public.customer_savings_goals WHERE id='" + result['goalId'] + "'"))
        self.assertEqual(snapshot['variantLabel'], 'synthetic-sku')
        self.assertEqual(snapshot['price'], 1500)
        self.assertEqual(snapshot['cataloguePrice'], 1500)
        self.assertEqual(snapshot['selectionStatus'], 'exact')

    def test_variant_required_or_inactive_product_does_not_create_a_fake_plan(self):
        self.database.query("""
          INSERT INTO public.product_variants(id,product_id,merchant_id)
          SELECT 'b9b9b9b9-0000-4000-8000-000000000002',id,merchant_id FROM public.products;
        """)
        with self.assertRaises(subprocess.CalledProcessError):
            self.database.query(build_sql('apply', self.database.payload()))
        self.database.reset()
        self.database.query("UPDATE public.products SET status='inactive'")
        with self.assertRaises(subprocess.CalledProcessError):
            self.database.query(build_sql('apply', self.database.payload()))
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')

    def test_trigger_with_financial_side_effect_rolls_back_the_entire_candidate(self):
        self.database.query("""
          CREATE FUNCTION public.synthetic_forbidden_effect() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN UPDATE prefunded_card.treasury_bindings SET consumed_kobo=1; RETURN NEW; END $$;
          CREATE TRIGGER synthetic_forbidden_effect AFTER INSERT ON public.customer_savings_goals
            FOR EACH ROW EXECUTE FUNCTION public.synthetic_forbidden_effect();
        """)
        payload = self.database.payload()
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.database.query(build_sql('apply', payload))
        self.assertIn('protected state changed', caught.exception.stderr)
        self.assertEqual(self.database.query('SELECT consumed_kobo FROM prefunded_card.treasury_bindings'), '0')
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_goals'), '1')

    def test_official_rpc_rejects_unlinked_actor_even_when_driver_cannot_change_it(self):
        payload = self.database.payload()
        payload['actorId'] = 'aaaaaaaa-0000-4000-8000-000000000001'
        with self.assertRaises(subprocess.CalledProcessError):
            self.database.query(build_sql('apply', payload))
        self.assertEqual(self.database.query('SELECT count(*) FROM public.customer_savings_events'), '0')


if __name__ == '__main__':
    unittest.main()
