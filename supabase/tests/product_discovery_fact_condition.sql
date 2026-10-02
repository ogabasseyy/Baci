-- Requested conditions narrow fact retrieval before the ranking cap with
-- the live variant/offer/base semantics, so other-condition rows cannot
-- crowd out the only matching option.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES
  (
    'cb58d110-0000-4000-8000-000000000604',
    'fact-condition-test@example.test',
    'Fact Condition Test Merchant',
    'fact-condition-test-merchant',
    true
  ),
  (
    'cb58d110-0000-4000-8000-000000000605',
    'fact-exclusion-test@example.test',
    'Fact Exclusion Test Merchant',
    'fact-exclusion-test-merchant',
    true
  ),
  (
    'cb58d110-0000-4000-8000-000000000606',
    'fact-availability-test@example.test',
    'Fact Availability Test Merchant',
    'fact-availability-test-merchant',
    true
  );

INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, condition, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000621', 'cb58d110-0000-4000-8000-000000000604',
   'Black new widget', 'black-new-widget', 'Acme', 50000, 'active', false, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000622', 'cb58d110-0000-4000-8000-000000000604',
   'Black new gadget', 'black-new-gadget', 'Acme', 50000, 'active', false, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000623', 'cb58d110-0000-4000-8000-000000000604',
   'Black widget', 'black-widget', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000625', 'cb58d110-0000-4000-8000-000000000604',
   'Black depleted widget', 'black-depleted-widget', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000627', 'cb58d110-0000-4000-8000-000000000604',
   'Black unlimited widget', 'black-unlimited-widget', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000629', 'cb58d110-0000-4000-8000-000000000604',
   'Black strict widget', 'black-strict-widget', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000631', 'cb58d110-0000-4000-8000-000000000604',
   'Black paired depleted', 'black-paired-depleted', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}'),
  ('cb58d110-0000-4000-8000-000000000634', 'cb58d110-0000-4000-8000-000000000604',
   'Black paired stocked', 'black-paired-stocked', 'Acme', 50000, 'active', true, 'new',
   '{"product_type":"phone","attributes":{"color":"black"}}');

-- Exclusion fixtures live on their own merchant: a phone, a tablet, and a
-- type-less row that drops with the phone under a nonempty exclusion list.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, condition, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000637', 'cb58d110-0000-4000-8000-000000000605',
   'Black exclusion phone', 'black-exclusion-phone', 'Excl', 50000, 'active', false, 'new',
   '{"product_type":"phone"}'),
  ('cb58d110-0000-4000-8000-000000000638', 'cb58d110-0000-4000-8000-000000000605',
   'Black exclusion tablet', 'black-exclusion-tablet', 'Excl', 50000, 'active', false, 'new',
   '{"product_type":"tablet"}'),
  ('cb58d110-0000-4000-8000-000000000639', 'cb58d110-0000-4000-8000-000000000605',
   'Black exclusion typeless', 'black-exclusion-typeless', 'Excl', 50000, 'active', false, 'new',
   '{}');

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES (
  'cb58d110-0000-4000-8000-000000000624', 'cb58d110-0000-4000-8000-000000000623',
  'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 5, 'used'
);

-- A depleted untracked used variant satisfies nothing; the serialized
-- twins qualify through their policies (unlimited needs no units).
INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, stock_quantity, condition, inventory_tracking_policy)
VALUES
  ('cb58d110-0000-4000-8000-000000000626', 'cb58d110-0000-4000-8000-000000000625',
   'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 0, 'used', 'off'),
  ('cb58d110-0000-4000-8000-000000000628', 'cb58d110-0000-4000-8000-000000000627',
   'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 0, 'used', 'serialized_then_unlimited'),
  ('cb58d110-0000-4000-8000-000000000630', 'cb58d110-0000-4000-8000-000000000629',
   'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 0, 'used', 'serialized_strict');

INSERT INTO public.variant_inventory
  (variant_id, merchant_id, identifier_type, identifier_value, status)
VALUES (
  'cb58d110-0000-4000-8000-000000000630', 'cb58d110-0000-4000-8000-000000000604',
  'serial', 'STRICT-UNIT-1', 'available'
);

-- Paired offers need a purchasable variant: the depleted twin's active
-- used offer satisfies nothing; the stocked twin qualifies through it.
INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, stock_quantity, condition)
VALUES
  ('cb58d110-0000-4000-8000-000000000632', 'cb58d110-0000-4000-8000-000000000631',
   'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 0, NULL),
  ('cb58d110-0000-4000-8000-000000000635', 'cb58d110-0000-4000-8000-000000000634',
   'cb58d110-0000-4000-8000-000000000604', '{"storage_gb":256}', 5, NULL);

INSERT INTO public.product_offers
  (id, product_id, merchant_id, condition, price, stock_quantity, status)
VALUES
  ('cb58d110-0000-4000-8000-000000000633', 'cb58d110-0000-4000-8000-000000000631',
   'cb58d110-0000-4000-8000-000000000604', 'used', 40000, 2, 'active'),
  ('cb58d110-0000-4000-8000-000000000636', 'cb58d110-0000-4000-8000-000000000634',
   'cb58d110-0000-4000-8000-000000000604', 'used', 40000, 2, 'active');

-- Availability fixtures live on their own merchant: a depleted managed
-- base and a unit-less strict anchor drop; unmanaged, stocked,
-- stocked-anchor, and unlimited bases stay. The oversized parent drops
-- as snapshot-truncated.
INSERT INTO public.products
  (id, merchant_id, name, slug, brand, price, status, has_variants, condition,
   manage_stock, stock_quantity, inventory_tracking_policy, discovery_metadata)
VALUES
  ('cb58d110-0000-4000-8000-000000000640', 'cb58d110-0000-4000-8000-000000000606',
   'Black depleted base', 'black-depleted-base', 'Acme', 50000, 'active', false, 'new',
   true, 0, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000641', 'cb58d110-0000-4000-8000-000000000606',
   'Black unmanaged base', 'black-unmanaged-base', 'Acme', 50000, 'active', false, 'new',
   false, 0, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000642', 'cb58d110-0000-4000-8000-000000000606',
   'Black stocked base', 'black-stocked-base', 'Acme', 50000, 'active', false, 'new',
   true, 5, 'off', '{}'),
  ('cb58d110-0000-4000-8000-000000000643', 'cb58d110-0000-4000-8000-000000000606',
   'Black strict anchor stocked', 'black-strict-anchor-stocked', 'Acme', 50000, 'active', false, 'new',
   true, 0, 'serialized_strict', '{}'),
  ('cb58d110-0000-4000-8000-000000000645', 'cb58d110-0000-4000-8000-000000000606',
   'Black strict anchor depleted', 'black-strict-anchor-depleted', 'Acme', 50000, 'active', false, 'new',
   true, 0, 'serialized_strict', '{}'),
  ('cb58d110-0000-4000-8000-000000000647', 'cb58d110-0000-4000-8000-000000000606',
   'Black unlimited anchor zero', 'black-unlimited-anchor-zero', 'Acme', 50000, 'active', false, 'new',
   true, 0, 'serialized_then_unlimited', '{}'),
  ('cb58d110-0000-4000-8000-000000000649', 'cb58d110-0000-4000-8000-000000000606',
   'Black oversized', 'black-oversized', 'Acme', 50000, 'active', true, 'new',
   true, 5, 'off', '{}');

INSERT INTO public.product_variants
  (id, product_id, merchant_id, attributes, stock_quantity, condition,
   is_inventory_anchor, inventory_tracking_policy)
VALUES
  ('cb58d110-0000-4000-8000-000000000644', 'cb58d110-0000-4000-8000-000000000643',
   'cb58d110-0000-4000-8000-000000000606', '{"role":"anchor"}', 0, 'new', true, 'inherit'),
  ('cb58d110-0000-4000-8000-000000000646', 'cb58d110-0000-4000-8000-000000000645',
   'cb58d110-0000-4000-8000-000000000606', '{"role":"anchor"}', 0, 'new', true, 'inherit'),
  ('cb58d110-0000-4000-8000-000000000648', 'cb58d110-0000-4000-8000-000000000647',
   'cb58d110-0000-4000-8000-000000000606', '{"role":"anchor"}', 0, 'new', true, 'inherit');

INSERT INTO public.variant_inventory
  (variant_id, merchant_id, identifier_type, identifier_value, status)
VALUES (
  'cb58d110-0000-4000-8000-000000000644', 'cb58d110-0000-4000-8000-000000000606',
  'serial', 'AVAIL-606-1', 'available'
);

INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, stock_quantity, condition)
SELECT ('cb58d110-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
  'cb58d110-0000-4000-8000-000000000649',
  'cb58d110-0000-4000-8000-000000000606',
  jsonb_build_object('storage_gb', 256, 'slot', g), 5, 'new'
FROM pg_catalog.generate_series(1, 129) AS g;

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'anon', true);

DO $$
DECLARE
  fact_ids uuid[];
BEGIN
  IF current_user <> 'anon' THEN
    RAISE EXCEPTION 'RPC regression must run as the public caller';
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => 'used'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 4
    OR NOT (fact_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000623'::uuid,
      'cb58d110-0000-4000-8000-000000000627'::uuid,
      'cb58d110-0000-4000-8000-000000000629'::uuid,
      'cb58d110-0000-4000-8000-000000000634'::uuid
    ])
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000625'::uuid]
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000631'::uuid] THEN
    RAISE EXCEPTION 'used facts must keep purchasable used variants only, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => 'new'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 3
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000623'::uuid] THEN
    RAISE EXCEPTION 'new facts must drop the used-variant product, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    'cb58d110-0000-4000-8000-000000000604', 'black'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 6
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000625'::uuid]
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000631'::uuid] THEN
    RAISE EXCEPTION 'unconditioned facts must filter unavailable rows, got %', fact_ids;
  END IF;
  -- Availability gates every fact mode before ranking: the depleted
  -- managed base, the unit-less strict anchor, and the oversized parent
  -- drop; unmanaged, stocked, stocked-anchor, and unlimited bases stay.
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    'cb58d110-0000-4000-8000-000000000606', 'black'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 4
    OR NOT (fact_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000641'::uuid,
      'cb58d110-0000-4000-8000-000000000642'::uuid,
      'cb58d110-0000-4000-8000-000000000643'::uuid,
      'cb58d110-0000-4000-8000-000000000647'::uuid
    ])
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000640'::uuid]
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000645'::uuid]
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000649'::uuid] THEN
    RAISE EXCEPTION 'availability facts must keep servable bases only, got %', fact_ids;
  END IF;
  -- Intent-level excluded types filter before ranking; the type-less row
  -- drops with the phone under a nonempty exclusion list.
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000605',
    query_text => 'black',
    excluded_types_filter => '["phone"]'::jsonb
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 1
    OR fact_ids[1] IS DISTINCT FROM 'cb58d110-0000-4000-8000-000000000638'::uuid THEN
    RAISE EXCEPTION 'excluded facts must keep the tablet only, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000605',
    query_text => 'black'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'unexcluded facts must keep all three rows, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000605',
    query_text => 'black',
    excluded_types_filter => (SELECT pg_catalog.jsonb_agg('phone'::text)
      FROM pg_catalog.generate_series(1, 11))
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-count excluded types must narrow to no rows, got %', fact_ids;
  END IF;
  -- Scalar filters beyond the public schema limits narrow to no rows.
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    brand_filter => repeat('b', 51)
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-long brand filters must narrow to no rows, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    category_filter => repeat('c', 51)
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-long category filters must narrow to no rows, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => repeat('n', 51)
  );
  IF fact_ids IS NOT NULL THEN
    RAISE EXCEPTION 'over-long condition filters must narrow to no rows, got %', fact_ids;
  END IF;
END;
$$;

ROLLBACK;
