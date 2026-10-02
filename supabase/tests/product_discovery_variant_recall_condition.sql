-- Requested conditions narrow variant recall before the cap with the live
-- variant/offer/base semantics, so matching used options are not crowded
-- out by other-condition rows.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000503',
  'condition-test@example.test',
  'Condition Test Merchant',
  'condition-test-merchant',
  true
);

INSERT INTO public.products
  (id, merchant_id, name, slug, price, status, has_variants, manage_stock, condition, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000511', 'cb58d110-0000-4000-8000-000000000503',
   'New-only 256GB', 'new-only-256gb', 50000, 'active', true, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000512', 'cb58d110-0000-4000-8000-000000000503',
   'Used 256GB', 'used-256gb', 50000, 'active', true, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000513', 'cb58d110-0000-4000-8000-000000000503',
   'Offer-only used 256GB', 'offer-only-used-256gb', 50000, 'active', true, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000514', 'cb58d110-0000-4000-8000-000000000503',
   'Used base', 'used-base', 50000, 'active', false, true, 'used', '{}'),
  ('cb58d110-0000-4000-8000-000000000515', 'cb58d110-0000-4000-8000-000000000503',
   'Axis-owned offer', 'axis-owned-offer', 50000, 'active', true, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000516', 'cb58d110-0000-4000-8000-000000000503',
   'Inactive offer', 'inactive-offer', 50000, 'active', false, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000517', 'cb58d110-0000-4000-8000-000000000503',
   'Open-box 256GB', 'open-box-256gb', 50000, 'active', true, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000518', 'cb58d110-0000-4000-8000-000000000503',
   'Depleted bare offer', 'depleted-bare-offer', 50000, 'active', false, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000519', 'cb58d110-0000-4000-8000-000000000503',
   'Stocked bare offer', 'stocked-bare-offer', 50000, 'active', false, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000520', 'cb58d110-0000-4000-8000-000000000503',
   'Shadowed bare offer', 'shadowed-bare-offer', 50000, 'active', false, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000538', 'cb58d110-0000-4000-8000-000000000503',
   'First-stocked bare offer', 'first-stocked-bare-offer', 50000, 'active', false, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000542', 'cb58d110-0000-4000-8000-000000000503',
   'Oversized 256GB', 'oversized-256gb', 50000, 'active', true, true, 'new', '{}'),
  ('cb58d110-0000-4000-8000-000000000543', 'cb58d110-0000-4000-8000-000000000503',
   'Depleted new base with used offer', 'depleted-new-base-used-offer', 50000, 'active', false, true, 'new', '{}');

UPDATE public.products SET stock_quantity = 0
WHERE id = 'cb58d110-0000-4000-8000-000000000543';
UPDATE public.products SET stock_quantity = 5
WHERE id = 'cb58d110-0000-4000-8000-000000000514';

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES
  ('cb58d110-0000-4000-8000-000000000521', 'cb58d110-0000-4000-8000-000000000511',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'new'),
  ('cb58d110-0000-4000-8000-000000000522', 'cb58d110-0000-4000-8000-000000000512',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'used'),
  -- A conditionless variant leaves the axis to the matching offer below.
  ('cb58d110-0000-4000-8000-000000000523', 'cb58d110-0000-4000-8000-000000000513',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, NULL),
  -- A variant row under a variant-less flag still resolves through the base.
  ('cb58d110-0000-4000-8000-000000000524', 'cb58d110-0000-4000-8000-000000000514',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'new'),
  -- A conditioned variant owns the axis, disabling the matching offer below.
  ('cb58d110-0000-4000-8000-000000000525', 'cb58d110-0000-4000-8000-000000000515',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'new'),
  ('cb58d110-0000-4000-8000-000000000526', 'cb58d110-0000-4000-8000-000000000516',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'new'),
  ('cb58d110-0000-4000-8000-000000000527', 'cb58d110-0000-4000-8000-000000000517',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'open_box'),
  -- Conditionless variants under variant-less flags resolve through the
  -- base or the bare offer below.
  ('cb58d110-0000-4000-8000-000000000528', 'cb58d110-0000-4000-8000-000000000518',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, NULL),
  ('cb58d110-0000-4000-8000-000000000529', 'cb58d110-0000-4000-8000-000000000519',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, NULL),
  ('cb58d110-0000-4000-8000-000000000530', 'cb58d110-0000-4000-8000-000000000520',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, NULL),
  ('cb58d110-0000-4000-8000-000000000539', 'cb58d110-0000-4000-8000-000000000538',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, NULL),
  ('cb58d110-0000-4000-8000-000000000544', 'cb58d110-0000-4000-8000-000000000543',
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 0, NULL);

-- An oversized parent carries 129 non-anchor variants: hydration drops it
-- outright, so recall must filter it before the window.
INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
SELECT ('cb58d110-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  'cb58d110-0000-4000-8000-000000000542',
  'cb58d110-0000-4000-8000-000000000503',
  jsonb_build_object('storage_gb', 256, 'slot', g), 5, 'new'
FROM pg_catalog.generate_series(1, 129) AS g;

INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000531', 'cb58d110-0000-4000-8000-000000000513',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000532', 'cb58d110-0000-4000-8000-000000000515',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000533', 'cb58d110-0000-4000-8000-000000000516',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'sold_out'),
  -- A depleted bare offer on a managed product satisfies nothing; the
  -- stocked twin is the positive control.
  ('cb58d110-0000-4000-8000-000000000534', 'cb58d110-0000-4000-8000-000000000518',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 0, 'active'),
  ('cb58d110-0000-4000-8000-000000000535', 'cb58d110-0000-4000-8000-000000000519',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'active'),
  -- Duplicate bare offers resolve first-row-wins. UNIQUE(product_id,
  -- condition) forbids two used rows, so the pair rides the only
  -- schema-legal canonical collision: open_box sorts first and both rows
  -- canonicalize to open_box. The shadowed product's ordered-first row is
  -- depleted, the twin's is stocked.
  ('cb58d110-0000-4000-8000-000000000536', 'cb58d110-0000-4000-8000-000000000520',
   'cb58d110-0000-4000-8000-000000000503', 'open_box', 40000, 0, 'active'),
  ('cb58d110-0000-4000-8000-000000000537', 'cb58d110-0000-4000-8000-000000000520',
   'cb58d110-0000-4000-8000-000000000503', 'refurbished', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000540', 'cb58d110-0000-4000-8000-000000000538',
   'cb58d110-0000-4000-8000-000000000503', 'open_box', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000541', 'cb58d110-0000-4000-8000-000000000538',
   'cb58d110-0000-4000-8000-000000000503', 'refurbished', 40000, 0, 'active'),
  ('cb58d110-0000-4000-8000-000000000545', 'cb58d110-0000-4000-8000-000000000543',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'active');

-- Helper pins run as service_role like the other direct discovery calls;
-- only the published RPC surface runs as the public caller below.
DO $$
BEGIN
  IF discovery.canonical_product_condition('Open Box') IS DISTINCT FROM 'open_box'
    OR discovery.canonical_product_condition('uk_used') IS DISTINCT FROM 'used'
    OR discovery.canonical_product_condition('REFURBISHED') IS DISTINCT FROM 'open_box'
    OR discovery.canonical_product_condition('bogus') IS NOT NULL
    OR discovery.canonical_product_condition(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'canonical condition helper diverged from the runtime normalizer';
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
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    p_limit => 10,
    p_condition => 'used'
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 5
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000512'::uuid,
      'cb58d110-0000-4000-8000-000000000513'::uuid,
      'cb58d110-0000-4000-8000-000000000514'::uuid,
      'cb58d110-0000-4000-8000-000000000519'::uuid,
      'cb58d110-0000-4000-8000-000000000543'::uuid
    ])
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000511'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000518'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000520'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000538'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000542'::uuid] THEN
    RAISE EXCEPTION 'used recall must keep variant, offer and base matches only, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    p_limit => 10,
    p_condition => 'new'
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 3
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000511'::uuid,
      'cb58d110-0000-4000-8000-000000000513'::uuid,
      'cb58d110-0000-4000-8000-000000000515'::uuid
    ])
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000512'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000514'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000516'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000518'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000519'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000520'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000517'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000538'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000542'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000543'::uuid] THEN
    RAISE EXCEPTION 'new recall must drop used-only, open-box-only and unavailable-base products, got %', recall_ids;
  END IF;
  -- A legacy requested spelling canonicalizes before comparing, matching
  -- hydration: refurbished recalls the open-box option, the first-stocked
  -- twin resolves through its ordered-first stocked row, and the shadowed
  -- twin stays out on its depleted first row.
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    p_limit => 10,
    p_condition => 'refurbished'
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 2
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000517'::uuid,
      'cb58d110-0000-4000-8000-000000000538'::uuid
    ])
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000520'::uuid] THEN
    RAISE EXCEPTION 'refurbished recall must reach the open-box option and the first-stocked twin only, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000503',
    '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    20
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 12
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000542'::uuid] THEN
    RAISE EXCEPTION 'unconditioned recall must stay fail-open, got %', recall_ids;
  END IF;
  -- Scalar filters beyond the public schema limits reject before the query.
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_brand => repeat('b', 51));
    RAISE EXCEPTION 'over-long brand filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_category => repeat('c', 51));
    RAISE EXCEPTION 'over-long category filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_condition => repeat('n', 51));
    RAISE EXCEPTION 'over-long condition filters must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  -- Worst-case valid payloads stay retrievable: schema-max counts with
  -- fully-escaped values (~33KB of filters, ~39KB of identity) must not
  -- trip the byte caps (a bare call raises on rejection, failing the suite).
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'key', 'color', 'operator', 'eq',
        'value', repeat(chr(1), 100), 'branch', 0))
      FROM pg_catalog.generate_series(1, 50)),
    p_identity => (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'branch', branch, 'product_type', repeat(chr(2), 100),
        'brands', (SELECT pg_catalog.jsonb_agg(repeat(chr(3), 100))
          FROM pg_catalog.generate_series(1, 10)),
        'model', repeat(chr(4), 100),
        'compatible_with', repeat(chr(5), 100)))
      FROM pg_catalog.generate_series(0, 4) AS branch),
    p_limit => 10
  );
  -- Payloads beyond the caps still reject, by bytes and by element count.
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_filters => pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'key', 'color', 'operator', 'eq',
        'value', repeat('a', 41000), 'branch', 0)));
    RAISE EXCEPTION 'over-cap filter payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_filters => (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'key', 'color', 'operator', 'eq', 'value', 'black', 'branch', 0))
        FROM pg_catalog.generate_series(1, 51)));
    RAISE EXCEPTION 'over-count filter payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_identity => pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'branch', 0, 'model', repeat('a', 50000))));
    RAISE EXCEPTION 'over-cap identity payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.search_product_variant_recall(
      p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
      p_identity => (SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('branch', branch))
        FROM pg_catalog.generate_series(0, 5) AS branch));
    RAISE EXCEPTION 'over-count identity payloads must be rejected';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END;
$$;

ROLLBACK;
