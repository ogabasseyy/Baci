BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000201',
  'facts-test@example.test',
  'Facts Test Merchant',
  'facts-test-merchant',
  true
);

-- Availability-aware variant recall must keep stocked options inside the
-- bounded product cap, while inventory-untracked products remain eligible.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000213', 'cb58d110-0000-4000-8000-000000000201',
   'Sold out option', 'sold-out-option', 'Acme', 50000, 'active', true, true, '{}'),
  ('cb58d110-0000-4000-8000-000000000214', 'cb58d110-0000-4000-8000-000000000201',
   'Stocked option', 'stocked-option', 'Acme', 50000, 'active', true, true, '{}'),
  ('cb58d110-0000-4000-8000-000000000215', 'cb58d110-0000-4000-8000-000000000201',
   'Untracked option', 'untracked-option', 'Acme', 50000, 'active', true, false, '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000313', 'cb58d110-0000-4000-8000-000000000213',
   'cb58d110-0000-4000-8000-000000000201', '{"ram_gb":16}', 0),
  ('cb58d110-0000-4000-8000-000000000314', 'cb58d110-0000-4000-8000-000000000214',
   'cb58d110-0000-4000-8000-000000000201', '{"ram_gb":16}', 3),
  ('cb58d110-0000-4000-8000-000000000315', 'cb58d110-0000-4000-8000-000000000215',
   'cb58d110-0000-4000-8000-000000000201', '{"ram_gb":16}', 0);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.products
      (id, merchant_id, name, slug, price, status, discovery_metadata)
    VALUES
      ('cb58d110-0000-4000-8000-000000000216', 'cb58d110-0000-4000-8000-000000000201',
       'Invalid metadata fixture', 'invalid-metadata-fixture', 100, 'active', '{"unknown":"value"}');
    RAISE EXCEPTION 'direct product write accepted an unknown discovery metadata key';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.products
      (id, merchant_id, name, slug, price, status, discovery_metadata)
    VALUES
      ('cb58d110-0000-4000-8000-000000000217', 'cb58d110-0000-4000-8000-000000000201',
       'Invalid numeric metadata fixture', 'invalid-numeric-metadata-fixture', 100, 'active',
       '{"attributes":{"storage_gb":"256"}}');
    RAISE EXCEPTION 'direct product write accepted string storage_gb';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF NOT discovery.product_discovery_metadata_valid(
    '{"product_type":"phone","model":"A1","compatible_with":["USB-C dock"],"attributes":{"storage_gb":256,"color":"Black","supplier_score":4}}'::jsonb
  ) THEN
    RAISE EXCEPTION 'valid strict discovery metadata contract was rejected';
  END IF;
  IF discovery.product_discovery_metadata_valid('[]'::jsonb)
    OR discovery.product_discovery_metadata_valid('{"compatible_with":"phone"}'::jsonb)
    OR discovery.product_discovery_metadata_valid('{"attributes":{"Bad-Key":"value"}}'::jsonb)
    OR discovery.product_discovery_metadata_valid('{"attributes":{"ram_gb":-1}}'::jsonb)
    OR discovery.product_discovery_metadata_valid('{"attributes":{"storage_gb":1e309}}'::jsonb)
    OR discovery.product_discovery_metadata_valid('{"attributes":{"custom":1e309}}'::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator accepted an invalid structural edge';
  END IF;
  IF NOT discovery.product_discovery_metadata_valid('{"attributes":{"storage_gb":1.7976931348623157e308}}'::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator rejected Number.MAX_VALUE';
  END IF;
  IF discovery.product_discovery_metadata_valid(
    ('{"model":"' || repeat('😀', 100) || '"}')::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator accepted 200 UTF-16 units';
  END IF;
  IF NOT discovery.product_discovery_metadata_valid(
    ('{"model":"' || repeat('😀', 50) || '"}')::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator rejected 100 UTF-16 units';
  END IF;
END;
$$;

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
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000201',
    '[{"key":"ram_gb","operator":"eq","value":16}]'::jsonb,
    2
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 2
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000214'::uuid,
      'cb58d110-0000-4000-8000-000000000215'::uuid
    ])
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000213'::uuid] THEN
    RAISE EXCEPTION 'variant recall cap must prioritize stocked and untracked options, got %', recall_ids;
  END IF;
END;
$$;
ROLLBACK;
