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

-- Branch and serialized rankings run under an isolated merchant so the
-- stocked-recall cap assertions above keep their exact row counts.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000202',
  'branch-test@example.test',
  'Branch Test Merchant',
  'branch-test-merchant',
  true
);

-- A hybrid matching one constraint per branch must rank below a variant
-- completing one branch; serialized availability (not stored stock) decides
-- purchasability for serialized policies.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000411', 'cb58d110-0000-4000-8000-000000000202',
   'Complete option', 'complete-option', 'Acme', 50000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000412', 'cb58d110-0000-4000-8000-000000000202',
   'Hybrid option', 'hybrid-option', 'Acme', 50000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000413', 'cb58d110-0000-4000-8000-000000000202',
   'Serialized option', 'serialized-option', 'Acme', 50000, 'active', true, true, 'serialized_strict', '{}'),
  ('cb58d110-0000-4000-8000-000000000414', 'cb58d110-0000-4000-8000-000000000202',
   'Sold out exact option', 'sold-out-exact-option', 'Acme', 50000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000415', 'cb58d110-0000-4000-8000-000000000202',
   'Unlimited option', 'unlimited-option', 'Acme', 50000, 'active', true, true, 'serialized_then_unlimited', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000421', 'cb58d110-0000-4000-8000-000000000411',
   'cb58d110-0000-4000-8000-000000000202', '{"color":"black","storage_gb":256}', 5),
  ('cb58d110-0000-4000-8000-000000000422', 'cb58d110-0000-4000-8000-000000000412',
   'cb58d110-0000-4000-8000-000000000202', '{"color":"black","storage_gb":128}', 5),
  ('cb58d110-0000-4000-8000-000000000423', 'cb58d110-0000-4000-8000-000000000413',
   'cb58d110-0000-4000-8000-000000000202', '{"color":"red","storage_gb":64}', 0),
  ('cb58d110-0000-4000-8000-000000000424', 'cb58d110-0000-4000-8000-000000000414',
   'cb58d110-0000-4000-8000-000000000202', '{"color":"red","storage_gb":64}', 0),
  ('cb58d110-0000-4000-8000-000000000425', 'cb58d110-0000-4000-8000-000000000415',
   'cb58d110-0000-4000-8000-000000000202', '{"color":"red","storage_gb":64}', 0);

INSERT INTO public.variant_inventory (merchant_id, variant_id, identifier_type, identifier_value, status)
VALUES (
  'cb58d110-0000-4000-8000-000000000202',
  'cb58d110-0000-4000-8000-000000000423',
  'serial',
  'SER-0001',
  'available'
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

-- Binary64 parity fixtures run under an isolated merchant so the exact
-- row-count assertions above never observe them.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000203',
  'binary64-test@example.test',
  'Binary64 Test Merchant',
  'binary64-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000430', 'cb58d110-0000-4000-8000-000000000203',
   'Binary64 option', 'binary64-option', 'Acme', 50000, 'active', true, true, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000433', 'cb58d110-0000-4000-8000-000000000203',
   'Overflow option', 'overflow-option', 'Acme', 50000, 'active', true, true, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000431', 'cb58d110-0000-4000-8000-000000000430',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb": 256.00000000000001}', 5),
  ('cb58d110-0000-4000-8000-000000000432', 'cb58d110-0000-4000-8000-000000000433',
   'cb58d110-0000-4000-8000-000000000203', '{"storage_gb": 1e999}', 5);

-- JavaScript-trim fixtures run under their own merchant: the loader trims
-- U+FEFF while PostgreSQL [[:space:]] does not, so recall must use the
-- same explicit trim set or it strands the variant before the cap.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000207',
  'trim-test@example.test',
  'Trim Test Merchant',
  'trim-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000440', 'cb58d110-0000-4000-8000-000000000207',
   'Trim option', 'trim-option', 'Acme', 50000, 'active', true, true, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity)
VALUES
  ('cb58d110-0000-4000-8000-000000000441', 'cb58d110-0000-4000-8000-000000000440',
   'cb58d110-0000-4000-8000-000000000207', ('{"color":"black' || chr(65279) || '"}')::jsonb, 5);

-- Effective-policy purchasability fixtures: a depleted serialized_strict
-- variant under an unmanaged parent must rank below a purchasable match
-- instead of short-circuiting on the parent flag. The depleted product
-- sorts first by id so the old order would surface it ahead of the match.
INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000208',
  'strict-test@example.test',
  'Strict Test Merchant',
  'strict-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, manage_stock, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000450', 'cb58d110-0000-4000-8000-000000000208',
   'Depleted strict', 'depleted-strict', 'Acme', 50000, 'active', true, false, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000452', 'cb58d110-0000-4000-8000-000000000208',
   'Available control', 'available-control', 'Acme', 50000, 'active', true, false, 'off', '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, inventory_tracking_policy)
VALUES
  ('cb58d110-0000-4000-8000-000000000451', 'cb58d110-0000-4000-8000-000000000450',
   'cb58d110-0000-4000-8000-000000000208', '{"color":"black"}', 0, 'serialized_strict'),
  ('cb58d110-0000-4000-8000-000000000453', 'cb58d110-0000-4000-8000-000000000452',
   'cb58d110-0000-4000-8000-000000000208', '{"color":"black"}', 0, 'off');

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
  IF discovery.product_discovery_metadata_valid('{"attributes":{"storage_gb":256.00000000000001}}'::jsonb)
    OR discovery.product_discovery_metadata_valid('{"attributes":{"custom":9007199254740993}}'::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator accepted a decimal JavaScript cannot round-trip';
  END IF;
  IF NOT discovery.product_discovery_metadata_valid('{"attributes":{"screen_inches":15.6,"power_w":0.1}}'::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator rejected naturally written decimals';
  END IF;
  IF discovery.product_discovery_metadata_valid(
    ('{"model":"' || repeat('😀', 100) || '"}')::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator accepted 200 UTF-16 units';
  END IF;
  IF NOT discovery.product_discovery_metadata_valid(
    ('{"model":"' || repeat('😀', 50) || '"}')::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator rejected 100 UTF-16 units';
  END IF;
  IF discovery.product_discovery_metadata_valid(
    ('{"product_type":"' || repeat('ﬃ', 100) || '"}')::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator accepted a product type that NFKC-expands past 100 units';
  END IF;
  IF NOT discovery.product_discovery_metadata_valid(
    ('{"product_type":"' || repeat('ﬃ', 33) || '"}')::jsonb) THEN
    RAISE EXCEPTION 'discovery metadata validator rejected a product type within 100 canonical units';
  END IF;
END;
$$;

-- The binary64 round-trip pins its own float rendering: sessions running
-- with extra_float_digits = 0 (notably the hosted replay image) must
-- reach the same verdict instead of rejecting Number.MAX_VALUE.
DO $$
DECLARE
  ambient text;
BEGIN
  ambient := pg_catalog.current_setting('extra_float_digits');
  PERFORM pg_catalog.set_config('extra_float_digits', '0', true);
  IF NOT discovery.product_discovery_metadata_valid('{"attributes":{"storage_gb":1.7976931348623157e308}}'::jsonb) THEN
    RAISE EXCEPTION 'metadata validator verdict changed under extra_float_digits = 0';
  END IF;
  PERFORM pg_catalog.set_config('extra_float_digits', ambient, true);
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

DO $$
DECLARE
  recall_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000202',
    '[{"key":"color","operator":"eq","value":"black","branch":0},{"key":"storage_gb","operator":"eq","value":256,"branch":0},{"key":"color","operator":"eq","value":"white","branch":1},{"key":"storage_gb","operator":"eq","value":128,"branch":1}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 2
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000411'::uuid
    OR recall_ids[2] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000412'::uuid THEN
    RAISE EXCEPTION 'branch-complete variants must outrank cross-branch hybrids, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000202',
    '[{"key":"color","operator":"eq","value":"red"},{"key":"storage_gb","operator":"eq","value":64}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 3
    OR recall_ids[3] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000414'::uuid
    OR NOT (recall_ids[1:2] @> ARRAY[
      'cb58d110-0000-4000-8000-000000000413'::uuid,
      'cb58d110-0000-4000-8000-000000000415'::uuid
    ]) THEN
    RAISE EXCEPTION 'serialized availability must outrank stored-stock sold-out rows, got %', recall_ids;
  END IF;
END;
$$;

-- Binary64 recall parity: PostgREST decodes JSON numbers to doubles, so a
-- stored 256.00000000000001 reads as 256 downstream and must recall for an
-- exact 256 intent; past float8 range the loader observes Infinity, which
-- fails equality but satisfies lower-bounded ranges.
DO $$
DECLARE
  recall_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 1
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000430'::uuid THEN
    RAISE EXCEPTION 'sub-ULP stored numerics must recall for the decoded double, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000203',
    '[{"key":"storage_gb","operator":"gte","value":256}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 2
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000430'::uuid,
      'cb58d110-0000-4000-8000-000000000433'::uuid
    ]) THEN
    RAISE EXCEPTION 'past-range stored numerics must recall as Infinity for ranges, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000207',
    '[{"key":"color","operator":"eq","value":"black"}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 1
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000440'::uuid THEN
    RAISE EXCEPTION 'values with JavaScript-only trim characters must recall trimmed, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000208',
    '[{"key":"color","operator":"eq","value":"black"}]'::jsonb,
    10
  );
  IF recall_ids IS DISTINCT FROM ARRAY[
    'cb58d110-0000-4000-8000-000000000452'::uuid,
    'cb58d110-0000-4000-8000-000000000450'::uuid
  ] THEN
    RAISE EXCEPTION 'depleted strict variants must rank below purchasable matches, got %', recall_ids;
  END IF;
END;
$$;
ROLLBACK;
