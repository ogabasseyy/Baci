-- Requested conditions narrow fact retrieval before the ranking cap with
-- the live variant/offer/base semantics, so other-condition rows cannot
-- crowd out the only matching option.
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, business_name, slug, is_published)
VALUES (
  'cb58d110-0000-4000-8000-000000000604',
  'fact-condition-test@example.test',
  'Fact Condition Test Merchant',
  'fact-condition-test-merchant',
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
   '{"product_type":"phone","attributes":{"color":"black"}}');

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
  IF cardinality(fact_ids) IS DISTINCT FROM 3
    OR NOT (fact_ids @> ARRAY[
      'cb58d110-0000-4000-8000-000000000623'::uuid,
      'cb58d110-0000-4000-8000-000000000627'::uuid,
      'cb58d110-0000-4000-8000-000000000629'::uuid
    ])
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000625'::uuid] THEN
    RAISE EXCEPTION 'used facts must keep purchasable used variants only, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    merchant_id_param => 'cb58d110-0000-4000-8000-000000000604',
    query_text => 'black',
    condition_filter => 'new'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 2
    OR fact_ids @> ARRAY['cb58d110-0000-4000-8000-000000000623'::uuid] THEN
    RAISE EXCEPTION 'new facts must drop the used-variant product, got %', fact_ids;
  END IF;
  SELECT array_agg(product_id) INTO fact_ids
  FROM public.search_product_discovery_facts(
    'cb58d110-0000-4000-8000-000000000604', 'black'
  );
  IF cardinality(fact_ids) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'unconditioned facts must stay fail-open, got %', fact_ids;
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
