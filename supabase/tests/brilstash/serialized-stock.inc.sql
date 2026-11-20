SAVEPOINT serialized_stock;

INSERT INTO public.products (
  id, merchant_id, status, name, slug, condition, price, has_condition_offers,
  stock_quantity, stock, manage_stock, inventory_tracking_policy
) VALUES (
  '44000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'active', 'Fixture offer', 'fixture-offer', 'new', 300000, true,
  3, 3, true, 'serialized_then_unlimited'
);
INSERT INTO public.product_offers (id, merchant_id, product_id, condition, status, price, stock_quantity)
VALUES (
  '45000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '44000000-0000-4000-8000-000000000001', 'used', 'active', 290000, 5
);
INSERT INTO private.brilstash_listings (
  installation_id, source_kind, source_id, parent_product_id, external_id, pilot_slot, reviewed_identity
) VALUES
  ('30000000-0000-4000-8000-000000000001', 'offer', '45000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'finite-offer', 3, '{"condition":"used"}'),
  ('30000000-0000-4000-8000-000000000001', 'product', '44000000-0000-4000-8000-000000000001',
    '44000000-0000-4000-8000-000000000001', 'unbounded-product', 4, '{"condition":"new"}');

SET LOCAL ROLE authenticated;
DO $$
DECLARE rows jsonb := public.load_brilstash_catalogue_sources('30000000-0000-4000-8000-000000000001')->'rows';
BEGIN
  IF NOT (rows @> '[
    {"externalId":"finite-offer","visible":false},
    {"externalId":"unbounded-product","visible":true,"inventory":{"kind":"quantity","units":null,"legacyUnits":null}}
  ]'::jsonb) THEN
    RAISE EXCEPTION 'a condition offer bypassed the serialized checkout policy: %', rows;
  END IF;
END $$;
RESET ROLE;
UPDATE public.products SET inventory_tracking_policy = 'off'
WHERE id = '44000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
DECLARE rows jsonb := public.load_brilstash_catalogue_sources('30000000-0000-4000-8000-000000000001')->'rows';
BEGIN
  IF NOT (rows @> '[
    {"externalId":"finite-offer","visible":true,"inventory":{"kind":"quantity","units":5,"legacyUnits":null}}
  ]'::jsonb) THEN RAISE EXCEPTION 'a checkout-compatible condition offer lost its explicit allocation'; END IF;
END $$;
RESET ROLE;
UPDATE public.product_offers SET stock_quantity = NULL
WHERE id = '45000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
DECLARE rows jsonb := public.load_brilstash_catalogue_sources('30000000-0000-4000-8000-000000000001')->'rows';
BEGIN
  IF NOT (rows @> '[
    {"externalId":"finite-offer","visible":true,"inventory":{"kind":"quantity","units":null,"legacyUnits":null}}
  ]'::jsonb) THEN
    RAISE EXCEPTION 'unbounded offer was given a finite availability';
  END IF;
END $$;
ROLLBACK TO SAVEPOINT serialized_stock;
RELEASE SAVEPOINT serialized_stock;
