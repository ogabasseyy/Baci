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
   'Open-box 256GB', 'open-box-256gb', 50000, 'active', true, true, 'new', '{}');

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
   'cb58d110-0000-4000-8000-000000000503', '{"storage_gb":256}', 5, 'open_box');

INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000531', 'cb58d110-0000-4000-8000-000000000513',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000532', 'cb58d110-0000-4000-8000-000000000515',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000533', 'cb58d110-0000-4000-8000-000000000516',
   'cb58d110-0000-4000-8000-000000000503', 'used', 40000, 2, 'sold_out');

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
  IF cardinality(recall_ids) IS DISTINCT FROM 3
    OR NOT (recall_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000512'::uuid,
      'cb58d110-0000-4000-8000-000000000513'::uuid,
      'cb58d110-0000-4000-8000-000000000514'::uuid
    ])
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000511'::uuid] THEN
    RAISE EXCEPTION 'used recall must keep variant, offer and base matches only, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    p_limit => 10,
    p_condition => 'new'
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 5
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000512'::uuid]
    OR recall_ids @> ARRAY['cb58d110-0000-4000-8000-000000000517'::uuid] THEN
    RAISE EXCEPTION 'new recall must drop the used-only and open-box-only products, got %', recall_ids;
  END IF;
  -- A legacy requested spelling canonicalizes before comparing, matching
  -- hydration: refurbished recalls the open-box option.
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    p_merchant_id => 'cb58d110-0000-4000-8000-000000000503',
    p_filters => '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    p_limit => 10,
    p_condition => 'refurbished'
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 1
    OR recall_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000517'::uuid THEN
    RAISE EXCEPTION 'refurbished recall must reach the open-box option, got %', recall_ids;
  END IF;
  SELECT array_agg(product_id) INTO recall_ids
  FROM public.search_product_variant_recall(
    'cb58d110-0000-4000-8000-000000000503',
    '[{"key":"storage_gb","operator":"eq","value":256}]'::jsonb,
    10
  );
  IF cardinality(recall_ids) IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'unconditioned recall must stay fail-open, got %', recall_ids;
  END IF;
END;
$$;

ROLLBACK;
