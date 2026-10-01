BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

-- Identity ranking runs under its own merchant so stocked-cap assertions
-- in the companion file keep their exact row counts.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000203',
  'identity-test@example.test',
  'Identity Test Merchant',
  'identity-test-merchant',
  true
);

-- Every variant below exactly satisfies storage_gb=256, so identity alone
-- orders the window: the verified phone first, unverified rows next
-- (fail open), type- and brand-contradicted rows last.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, category, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000231', 'cb58d110-0000-4000-8000-000000000203',
   'Identity phone', 'identity-phone', 'Acme', 'Smartphones', 50000, 'active', true, true, 'off',
   '{"product_type":"phone","model":"A1","compatible_with":["USB-C dock"]}'),
  ('cb58d110-0000-4000-8000-000000000232', 'cb58d110-0000-4000-8000-000000000203',
   'Identity laptop', 'identity-laptop', 'Acme', 'Laptops', 90000, 'active', true, true, 'off',
   '{"product_type":"laptop"}'),
  ('cb58d110-0000-4000-8000-000000000233', 'cb58d110-0000-4000-8000-000000000203',
   'Untyped gadget', 'untyped-gadget', NULL, NULL, 10000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000234', 'cb58d110-0000-4000-8000-000000000203',
   'Category phone', 'category-phone', NULL, 'Smartphones', 40000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000235', 'cb58d110-0000-4000-8000-000000000203',
   'Rival phone', 'rival-phone', 'Contoso', 'Smartphones', 45000, 'active', true, true, 'off',
   '{"product_type":"phone"}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000241', 'cb58d110-0000-4000-8000-000000000231',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb":256}', 5),
  ('cb58d110-0000-4000-8000-000000000242', 'cb58d110-0000-4000-8000-000000000232',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb":256}', 5),
  ('cb58d110-0000-4000-8000-000000000243', 'cb58d110-0000-4000-8000-000000000233',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb":256}', 5),
  ('cb58d110-0000-4000-8000-000000000244', 'cb58d110-0000-4000-8000-000000000234',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb":256}', 5),
  ('cb58d110-0000-4000-8000-000000000245', 'cb58d110-0000-4000-8000-000000000235',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb":256}', 5);

-- Exercise the recall RPC as its public storefront caller, under publication RLS.
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  recall_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id ORDER BY rank) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"eq","value":256,"branch":0}]'::jsonb,
    10,
    0,
    '[{"branch":0,"product_type":"phone","brands":["Acme"],"model":"A1","compatible_with":"USB-C dock"}]'::jsonb
  ) WITH ORDINALITY AS ranked(product_id, attributes, rank);
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000231'::uuid,
    'cb58d110-0000-4000-8000-000000000233'::uuid,
    'cb58d110-0000-4000-8000-000000000234'::uuid,
    'cb58d110-0000-4000-8000-000000000232'::uuid,
    'cb58d110-0000-4000-8000-000000000235'::uuid
  ] THEN
    RAISE EXCEPTION 'identity-verified products must outrank unverified and contradicted ones, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id ORDER BY rank) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"eq","value":256,"branch":0}]'::jsonb,
    10,
    0,
    '[{"branch":0,"product_type":"Smartphones"}]'::jsonb
  ) WITH ORDINALITY AS ranked(product_id, attributes, rank);
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000231'::uuid,
    'cb58d110-0000-4000-8000-000000000234'::uuid,
    'cb58d110-0000-4000-8000-000000000235'::uuid,
    'cb58d110-0000-4000-8000-000000000233'::uuid,
    'cb58d110-0000-4000-8000-000000000232'::uuid
  ] THEN
    RAISE EXCEPTION 'raw type aliases must canonicalize and categories must backstop missing types, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id ORDER BY rank) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"eq","value":256,"branch":0}]'::jsonb,
    10
  ) WITH ORDINALITY AS ranked(product_id, attributes, rank);
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000231'::uuid,
    'cb58d110-0000-4000-8000-000000000232'::uuid,
    'cb58d110-0000-4000-8000-000000000233'::uuid,
    'cb58d110-0000-4000-8000-000000000234'::uuid,
    'cb58d110-0000-4000-8000-000000000235'::uuid
  ] THEN
    RAISE EXCEPTION 'empty identity must leave recall order neutral, got %', recall_ids;
  END IF;
END;
$$;
ROLLBACK;
